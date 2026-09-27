import { AuthorizationGrant } from "../core/access";
import { RelationshipTypeRegistry } from "../core/relationship.registry";
import { normalizeKnowledgeContext, KnowledgeContext } from "../knowledge/knowledge-context";
import { KnowledgeRequirement } from "../knowledge/knowledge-requirement.types";
import { resolveKnowledge } from "../knowledge/knowledge.resolver";
import { KnowledgeRetriever } from "../knowledge/knowledge-retriever";
import { KnowledgeSourceRegistry } from "../knowledge/knowledge-source.registry";
import { KnowledgeArtifact } from "../knowledge/knowledge-source.types";
import { ContextCompiler, compileCapabilitySummaries } from "./context-compiler";
import { stableIdentity } from "./intelligence-identity";
import { knowledgeNeedsToRequirements } from "./intelligence-knowledge-needs";
import { IntelligenceProviderRegistry } from "./intelligence-provider.registry";
import {
  IntelligenceProvider,
  IntelligenceRequest,
  KnowledgeNeed,
  ReasoningResult,
  StructuredIntent,
} from "./intelligence-provider.types";
import {
  DEFAULT_REASONING_BUDGET,
  ProposalIssue,
  ReasoningBudget,
  ReasoningContextInput,
  ReasoningRound,
  ReasoningRunResult,
  ReasoningStopReason,
} from "./reasoning.types";

export interface ReasoningServiceInput extends ReasoningContextInput {
  projectId: string;
  knowledgeSources?: KnowledgeSourceRegistry;
  retriever?: KnowledgeRetriever;
  relationshipTypeRegistry?: RelationshipTypeRegistry;
  authorizationGrants?: readonly AuthorizationGrant[];
  budget?: Partial<ReasoningBudget>;
  providerId?: string;
}

const reasoningOutputContract = Object.freeze({
  fields: ["conclusions", "proposedTasks", "requiredCapabilities", "additionalKnowledgeNeeds", "outputRequirements", "uncertainty", "evidenceReferences"] as const,
  description: "A structured proposal describing what should happen. It is not an execution command.",
});

/**
 * The canonical reasoning boundary.
 *
 *   StructuredIntent + KnowledgeContext + BilContext + available capabilities
 *        -> ContextCompiler -> IntelligenceRequest -> IntelligenceProvider
 *        -> validated ReasoningResult (a proposal, never a command)
 *
 * When a proposal asks for knowledge Bikting does not hold, the needs become canonical
 * KnowledgeRequirements, are resolved and retrieved through the existing Phase 6 architecture, and
 * are compiled back into a new request. The loop is bounded by ReasoningBudget and stops as soon as
 * a round adds no new concepts, relationships, or needs.
 */
export class ReasoningService {
  constructor(
    private readonly providers: IntelligenceProviderRegistry,
    private readonly compiler: ContextCompiler = new ContextCompiler(),
  ) {}

  async reason(input: ReasoningServiceInput): Promise<ReasoningRunResult> {
    const budget = { ...DEFAULT_REASONING_BUDGET, ...(input.budget ?? {}) };
    validateBudget(budget);
    const provider = this.providers.resolveWithFallback("reason", input.providerId);
    const availableCapabilities = input.availableCapabilities.length
      ? input.availableCapabilities.map((capability) => ({ ...capability }))
      : compileCapabilitySummaries([]);
    const requests: IntelligenceRequest[] = [];
    const rounds: ReasoningRound[] = [];
    const issuedRequirements: KnowledgeRequirement[] = [];
    const artifacts: KnowledgeArtifact[] = [];
    let knowledgeContext = input.knowledgeContext;
    let reasoning: ReasoningResult | undefined;
    let stopReason: ReasoningStopReason = "max_rounds_reached";

    for (let round = 1; round <= budget.maxRounds; round += 1) {
      const request = this.compiler.compile({
        ...input,
        // The accumulated context must win over the original input, which never changes across rounds.
        knowledgeContext,
        availableCapabilities,
        task: "reason",
        objective: input.intent?.objective ?? input.projectId,
        requiredOutput: reasoningOutputContract,
        provenance: { projectId: input.projectId, callerId: provider.id, sourceType: "engine" },
        round,
        missingKnowledge: unresolvedSummary(knowledgeContext, input.missingKnowledge),
      });
      requests.push(request);
      const result = await provider.reason(request);
      reasoning = result;
      const issues = validateReasoningResult(result, request, knowledgeContext, provider);
      const needs = selectKnowledgeNeeds(result.additionalKnowledgeNeeds, issuedRequirements, budget);
      const beforeConcepts = new Set(knowledgeContext?.concepts.map(({ id }) => id) ?? []);
      const beforeRelationships = new Set(knowledgeContext?.relationships.map(({ id }) => id) ?? []);
      const retrieval = await this.retrieveForNeeds(needs, input, issuedRequirements, artifacts, round, knowledgeContext);
      knowledgeContext = retrieval.knowledgeContext;
      const afterConcepts = new Set(knowledgeContext?.concepts.map(({ id }) => id) ?? []);
      const afterRelationships = new Set(knowledgeContext?.relationships.map(({ id }) => id) ?? []);
      const addedConceptIds = [...afterConcepts].filter((id) => !beforeConcepts.has(id)).sort();
      const addedRelationshipIds = [...afterRelationships].filter((id) => !beforeRelationships.has(id)).sort();
      const unresolved = knowledgeContext?.unresolvedRequirementIds ?? [];
      // A round is only conclusive when the proposal is valid and asks for nothing further. When a
      // proposal does ask for knowledge and that knowledge was retrieved, the loop must run again so
      // the provider can reason against the evidence it requested.
      const sufficient = needs.length === 0 && issues.length === 0;
      const progress = addedConceptIds.length > 0 || addedRelationshipIds.length > 0 || retrieval.retrievedArtifacts.length > 0;
      rounds.push({
        round,
        requestId: request.id,
        providerId: provider.id,
        knowledgeRequirementIds: retrieval.requirementIds,
        unresolvedRequirementIds: [...unresolved],
        addedConceptIds,
        addedRelationshipIds,
        addedKnowledgeNeedIds: retrieval.requirementIds,
        progress,
        sufficient,
      });
      if (sufficient) { stopReason = "sufficient"; break; }
      if (needs.length && !retrieval.satisfied && !progress) { stopReason = "knowledge_unresolvable"; break; }
      if (!progress) { stopReason = "no_new_knowledge_needs"; break; }
      if (round === budget.maxRounds) { stopReason = "max_rounds_reached"; break; }
    }

    const finalReasoning = reasoning ?? emptyReasoning(provider, input.projectId);
    const finalRequest = requests[requests.length - 1];
    const issues = finalRequest ? validateReasoningResult(finalReasoning, finalRequest, knowledgeContext, provider) : [{ code: "malformed_proposal" as const, message: "The provider returned no proposal." }];
    return {
      reasoning: deepFreeze(structuredClone(finalReasoning)),
      requests,
      rounds,
      stopReason,
      knowledgeContext,
      knowledgeRequirements: issuedRequirements,
      artifacts,
      issues,
      valid: issues.length === 0,
      providerId: provider.id,
    };
  }

  /** Resolves and retrieves knowledge for the needs a proposal raised, reusing the Phase 6 path. */
  private async retrieveForNeeds(
    needs: readonly KnowledgeNeed[],
    input: ReasoningServiceInput,
    issued: KnowledgeRequirement[],
    artifacts: KnowledgeArtifact[],
    round: number,
    current: KnowledgeContext | undefined,
  ): Promise<{ knowledgeContext?: KnowledgeContext; retrievedArtifacts: KnowledgeArtifact[]; requirementIds: string[]; satisfied: boolean; unresolvable: boolean }> {
    if (!needs.length) return { knowledgeContext: current, retrievedArtifacts: [], requirementIds: [], satisfied: false, unresolvable: false };
    if (!input.knowledgeSources || !input.retriever || !input.relationshipTypeRegistry) {
      return { knowledgeContext: current, retrievedArtifacts: [], requirementIds: [], satisfied: false, unresolvable: true };
    }
    const requirements = knowledgeNeedsToRequirements(needs, { existingIds: issued.map(({ id }) => id) });
    issued.push(...requirements);
    const resolution = resolveKnowledge([...issued], input.knowledgeSources, { grants: input.authorizationGrants });
    const retrieved: KnowledgeArtifact[] = [];
    for (const entry of resolution.entries) {
      if (entry.unresolved) continue;
      for (const sourceId of entry.eligibleSourceIds) {
        const source = input.knowledgeSources.get(sourceId)!;
        const requirement = requirements.find(({ id }) => id === entry.requirementId) ?? issued.find(({ id }) => id === entry.requirementId)!;
        const retrievalId = `reasoning-retrieval-${stableIdentity({ projectId: input.projectId, round, requirementId: requirement.id, sourceId })}`;
        try {
          retrieved.push(...await input.retriever.retrieve({ retrievalId, requirement, source, projectContext: input.intent ? { objective: input.intent.objective } : undefined }));
        } catch {
          // A failed retrieval leaves the requirement unresolved rather than fabricating content.
        }
      }
    }
    artifacts.push(...retrieved);
    const merged = mergeArtifacts(current, artifacts);
    const knowledgeContext = normalizeKnowledgeContext(resolution, merged, input.relationshipTypeRegistry);
    const requirementIds = requirements.map(({ id }) => id);
    const satisfied = requirementIds.every((id) => !knowledgeContext.unresolvedRequirementIds.includes(id));
    return { knowledgeContext, retrievedArtifacts: retrieved, requirementIds, satisfied, unresolvable: !satisfied && !retrieved.length };
  }
}

function unresolvedSummary(context: KnowledgeContext | undefined, missing: ReasoningContextInput["missingKnowledge"]): { requirementId: string; reason: string }[] {
  return [
    ...(context?.unresolvedRequirementIds ?? []).map((requirementId) => ({ requirementId, reason: "Bikting could not resolve this knowledge requirement." })),
    ...(missing ?? []).map(({ requirementId, reason }) => ({ requirementId, reason })),
  ];
}

function selectKnowledgeNeeds(needs: readonly KnowledgeNeed[], issued: readonly KnowledgeRequirement[], budget: ReasoningBudget): KnowledgeNeed[] {
  const seen = new Set(issued.map(({ topic, domain }) => `${domain ?? ""}:${topic}`));
  const selected: KnowledgeNeed[] = [];
  for (const need of needs) {
    const key = `${need.domain ?? ""}:${need.topic}`;
    if (seen.has(key)) continue;
    if (selected.length >= budget.maxKnowledgeRequirementsPerRound) break;
    if (issued.length + selected.length >= budget.maxTotalKnowledgeRequirements) break;
    seen.add(key);
    selected.push(need);
  }
  return selected;
}

/**
 * Validates a proposal as untrusted structured input.
 *
 * A proposal may only name capabilities Bikting registered and is willing to consider, may only
 * depend on tasks inside the proposal, may not carry executable content, and may not cite evidence
 * Bikting did not retrieve. It still is not authorization: planning and the execution kernel apply
 * their own checks afterwards.
 */
export function validateReasoningResult(
  result: ReasoningResult,
  request: IntelligenceRequest,
  knowledgeContext: KnowledgeContext | undefined,
  provider: IntelligenceProvider,
): ProposalIssue[] {
  const issues: ProposalIssue[] = [];
  const add = (code: ProposalIssue["code"], message: string, reference?: string): void => { issues.push({ code, message, reference }); };
  if (!result || typeof result !== "object") { add("malformed_proposal", "The provider did not return a structured proposal."); return issues; }
  if (result.objective !== request.objective) add("objective_mismatch", "The proposal answers a different objective than the one Bikting asked about.", result.objective);
  const knownCapabilities = new Set(request.availableCapabilities.map(({ id }) => id));
  for (const capability of result.requiredCapabilities) {
    if (!knownCapabilities.has(capability.capabilityId)) add("unknown_capability", `The proposal requires a capability Bikting did not offer: ${capability.capabilityId}`, capability.capabilityId);
  }
  const taskIds = new Set(result.proposedTasks.map(({ id }) => id));
  for (const task of result.proposedTasks) {
    if (!knownCapabilities.has(task.capabilityId)) add("unauthorized_capability", `The proposal proposes a capability Bikting did not offer: ${task.capabilityId}`, task.capabilityId);
    for (const dependency of task.dependsOn ?? []) {
      if (!taskIds.has(dependency)) add("unknown_dependency", `Proposed task ${task.id} depends on an unknown task: ${dependency}`, dependency);
    }
    for (const binding of task.bindings ?? []) {
      if (binding.sourceType === "task_output" && !binding.taskId || binding.sourceType === "task_output" && binding.taskId && !taskIds.has(binding.taskId)) {
        add("unknown_dependency", `Binding in ${task.id} references an unknown task: ${String(binding.taskId)}`, String(binding.taskId));
      }
      if (binding.sourceType === "literal" && containsExecutable(binding.value)) add("executable_binding", `Binding in ${task.id} contains non-data content.`, task.id);
    }
  }
  if (hasCycle(result.proposedTasks)) add("dependency_cycle", "The proposal contains a dependency cycle.");
  const knownEvidence = new Set([
    ...(knowledgeContext?.concepts.map(({ id }) => id) ?? []),
    ...(knowledgeContext?.relationships.map(({ id }) => id) ?? []),
    ...(knowledgeContext ? [knowledgeContext.id] : []),
  ]);
  for (const reference of result.evidenceReferences) {
    if (reference.type === "knowledge_fact") continue;
    if (!knownEvidence.has(reference.id)) add("fabricated_evidence", `The proposal cites evidence Bikting did not retrieve: ${reference.id}`, reference.id);
  }
  for (const need of result.additionalKnowledgeNeeds) {
    if (typeof need.topic !== "string" || !need.topic.trim()) add("knowledge_need_malformed", "A knowledge need requires a topic.");
  }
  for (const issue of result.issues ?? []) add("malformed_proposal", issue.message, issue.reference);
  if (result.providerId !== provider.id) add("malformed_proposal", "The proposal reports a different provider than the one Bikting invoked.", result.providerId);
  return issues;
}

function hasCycle(tasks: readonly { id: string; dependsOn?: readonly string[] }[]): boolean {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) if (visit(dependency)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return tasks.some(({ id }) => visit(id));
}

function containsExecutable(value: unknown): boolean {
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint" || value === undefined) return true;
  if (Array.isArray(value)) return value.some(containsExecutable);
  return Boolean(value && typeof value === "object" && Object.values(value as Record<string, unknown>).some(containsExecutable));
}

function mergeArtifacts(existing: KnowledgeContext | undefined, artifacts: readonly KnowledgeArtifact[]): KnowledgeArtifact[] {
  const byId = new Map<string, KnowledgeArtifact>();
  for (const artifact of existing?.artifacts ?? []) byId.set(artifact.id, artifact);
  for (const artifact of artifacts) byId.set(artifact.id, artifact);
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function emptyReasoning(provider: IntelligenceProvider, projectId: string): ReasoningResult {
  return { id: `reasoning-${stableIdentity({ projectId, providerId: provider.id })}`, objective: projectId, conclusions: [], proposedTasks: [], requiredCapabilities: [], additionalKnowledgeNeeds: [], outputRequirements: [], evidenceReferences: [], providerId: provider.id };
}

function validateBudget(budget: ReasoningBudget): void {
  for (const [key, amount] of Object.entries(budget)) if (!Number.isInteger(amount) || amount < 1) throw new TypeError(`${key} must be a positive integer.`);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  return Object.freeze(value);
}

export type { StructuredIntent };
