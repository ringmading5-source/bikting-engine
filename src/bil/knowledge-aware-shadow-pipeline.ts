import { AuthorizationGrant } from "../core/access";
import { RelationshipTypeRegistry } from "../core/relationship.registry";
import { Relationship } from "../core/types";
import { CapabilityRegistry } from "../capabilities/capability.registry";
import { InMemoryExecutionEventLog } from "../execution/event-log";
import { ExecutionEvent } from "../execution/events";
import { UserIntent } from "../intent/intent.types";
import { normalizeKnowledgeContext, KnowledgeContext } from "../knowledge/knowledge-context";
import { resolveKnowledge } from "../knowledge/knowledge.resolver";
import { KnowledgeRetriever } from "../knowledge/knowledge-retriever";
import { KnowledgeSourceRegistry } from "../knowledge/knowledge-source.registry";
import { KnowledgeArtifact, KnowledgeResolution } from "../knowledge/knowledge-source.types";
import { ExecutionPlan } from "../planning/plan.types";
import { BilCompiler } from "./bil.compiler";
import { BilPlanningAdapter } from "./bil.planning.adapter";
import { BilRegistry } from "./bil.registry";
import { resolveBil } from "./bil.resolver";
import { BilContext, BilResolution } from "./bil.types";

export interface KnowledgeAwarePipelineInput { projectId: string; intent: UserIntent; bilRegistry: BilRegistry; capabilityRegistry: CapabilityRegistry; relationshipTypeRegistry: RelationshipTypeRegistry; knowledgeSources: KnowledgeSourceRegistry; retriever: KnowledgeRetriever; authorizationGrants?: readonly AuthorizationGrant[]; projectContext?: { relationships?: Relationship[]; modality?: string; values?: Record<string, unknown> }; }
export interface KnowledgeAwarePipelineResult { runId: string; resolution: BilResolution; bilContext: BilContext; knowledgeResolution: KnowledgeResolution; artifacts: KnowledgeArtifact[]; knowledgeContext: KnowledgeContext; plan: ExecutionPlan; events: ExecutionEvent[]; }

/** Shadow-only knowledge composition. Retrieval is limited to explicitly registered local adapters. */
export class KnowledgeAwareShadowPipeline {
  async run(input: KnowledgeAwarePipelineInput): Promise<KnowledgeAwarePipelineResult> {
    const runId = `knowledge-${hash(stableStringify({ projectId: input.projectId, intent: input.intent, modules: input.bilRegistry.list().map(({ id, version }) => ({ id, version })), sources: input.knowledgeSources.list(), grants: input.authorizationGrants ?? [] }))}`; const log = new InMemoryExecutionEventLog(runId);
    const resolution = resolveBil(input.bilRegistry, { intents: [...(input.intent.actions ?? [])], concepts: [...(input.intent.objects ?? [])], relationships: input.projectContext?.relationships, requestedOutputs: input.intent.desiredOutputs, availableCapabilityIds: input.capabilityRegistry.list().map(({ id }) => id), modality: input.projectContext?.modality, context: { ...(input.intent.context ?? {}), ...(input.projectContext?.values ?? {}) } });
    const modules = resolution.selectedModuleIds.map((id) => input.bilRegistry.get(id)).filter((value): value is NonNullable<typeof value> => Boolean(value)); const bilContext = new BilCompiler().compile({ intent: input.intent, resolution, modules, bilRegistry: input.bilRegistry, capabilityRegistry: input.capabilityRegistry, relationshipTypeRegistry: input.relationshipTypeRegistry });
    const requirements = bilContext.knowledgeRequirements.map(({ declaration }) => structuredClone(declaration)); log.append({ type: "knowledge_resolution_started", projectId: input.projectId, data: { requirementIds: requirements.map(({ id }) => id) } });
    let knowledgeResolution = resolveKnowledge(requirements, input.knowledgeSources, { grants: input.authorizationGrants, projectContext: input.projectContext?.values }); log.append({ type: "knowledge_resolution_completed", projectId: input.projectId, data: { resolutionId: knowledgeResolution.id, unresolvedRequirementIds: knowledgeResolution.unresolvedRequirementIds }, metadata: { candidates: Object.fromEntries(knowledgeResolution.entries.map(({ requirementId, candidateSourceIds }) => [requirementId, candidateSourceIds])) } });
    const artifacts: KnowledgeArtifact[] = []; const retrievalFailures = new Set<string>();
    for (const entry of knowledgeResolution.entries) for (const sourceId of entry.eligibleSourceIds) { const source = input.knowledgeSources.get(sourceId)!; const requirement = knowledgeResolution.requirements.find(({ id }) => id === entry.requirementId)!; const retrievalId = `retrieval-${hash(`${runId}:${requirement.id}:${sourceId}`)}`; log.append({ type: "knowledge_retrieval_started", projectId: input.projectId, data: { retrievalId, requirementId: requirement.id, sourceId } }); try { const retrieved = await input.retriever.retrieve({ retrievalId, requirement, source, projectContext: input.projectContext?.values }); artifacts.push(...retrieved); log.append({ type: "knowledge_retrieval_completed", projectId: input.projectId, data: { retrievalId, requirementId: requirement.id, sourceId, artifactIds: retrieved.map(({ id }) => id) } }); } catch { retrievalFailures.add(requirement.id); }
    }
    if (retrievalFailures.size) knowledgeResolution = withRetrievalFailures(knowledgeResolution, retrievalFailures);
    for (const requirementId of knowledgeResolution.unresolvedRequirementIds) log.append({ type: "knowledge_requirement_unresolved", projectId: input.projectId, data: { requirementId } });
    const knowledgeContext = normalizeKnowledgeContext(knowledgeResolution, artifacts, input.relationshipTypeRegistry); log.append({ type: "knowledge_context_created", projectId: input.projectId, data: { knowledgeContextId: knowledgeContext.id, artifactIds: artifacts.map(({ id }) => id), unresolvedRequirementIds: knowledgeContext.unresolvedRequirementIds } });
    for (const conflict of knowledgeContext.conflicts) log.append({ type: "knowledge_conflict_detected", projectId: input.projectId, data: { conflictId: conflict.id, subject: conflict.subject, sourceIds: conflict.candidates.map(({ sourceId }) => sourceId) } });
    const plan = new BilPlanningAdapter().createPlan(bilContext, knowledgeContext); return { runId, resolution, bilContext, knowledgeResolution, artifacts: structuredClone(artifacts), knowledgeContext, plan, events: log.list() };
  }
}
function withRetrievalFailures(resolution: KnowledgeResolution, failures: Set<string>): KnowledgeResolution { const entries = resolution.entries.map((entry) => failures.has(entry.requirementId) ? { ...entry, unresolved: true, reason: "Eligible local sources could not be retrieved." } : entry); return { ...resolution, entries, unresolvedRequirementIds: [...new Set([...resolution.unresolvedRequirementIds, ...failures])].sort() }; }
function stableStringify(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`; return JSON.stringify(value); }
function hash(value: string): string { let result = 2166136261; for (let i = 0; i < value.length; i++) { result ^= value.charCodeAt(i); result = Math.imul(result, 16777619); } return (result >>> 0).toString(16).padStart(8, "0"); }
