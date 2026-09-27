import type { BilContext } from "../bil/bil.types";
import type { KnowledgeContext } from "../knowledge/knowledge-context";
import {
  IntelligenceBilContext,
  IntelligenceCapabilitySummary,
  IntelligenceConstraint,
  IntelligenceKnowledgeConcept,
  IntelligenceKnowledgeContext,
  IntelligenceOutputContract,
  IntelligenceProvenance,
  IntelligenceRequest,
  IntelligenceTask,
  StructuredIntent,
} from "./intelligence-provider.types";
import type { ReasoningContextInput } from "./reasoning.types";
import { stableIdentity } from "./intelligence-identity";

export interface ContextCompilationInput extends ReasoningContextInput {
  task: IntelligenceTask;
  objective: string;
  requiredOutput: IntelligenceOutputContract;
  provenance: IntelligenceProvenance;
  round?: number;
}

/**
 * Context Compiler.
 *
 * Its only job is to select and structure the information a reasoning task needs. It never calls a
 * model, executes a tool, selects credentials, performs network requests, or mutates engine state,
 * and it never invents knowledge: concepts that were not retrieved are reported as gaps.
 *
 * Selection is structural. Concepts are included when they are declared by the intent or required
 * by a canonical knowledge requirement Bikting already holds, and the same rule is applied to
 * relationships, facts, and sources. Nothing about the subject matter is hard-coded here.
 */
export class ContextCompiler {
  compile(input: ContextCompilationInput): IntelligenceRequest {
    const intent = input.intent;
    const knowledge = input.knowledgeContext ? this.compileKnowledge(input) : undefined;
    const bil = input.bilContext ? this.compileBil(input.bilContext) : undefined;
    const concepts = unique([
      ...(intent?.concepts ?? []),
      ...(input.bilContext?.knowledgeRequirements.flatMap(({ declaration }) => declaration.concepts) ?? []),
      ...(knowledge?.concepts.map(({ id }) => id) ?? []),
    ]);
    const constraints: IntelligenceConstraint[] = [
      ...(input.constraints ?? []),
      ...(intent?.constraints ?? []),
      ...(input.bilContext?.constraints.map(({ declaration }) => ({ type: declaration.type, value: declaration.value, required: true })) ?? []),
    ];
    const availableCapabilities = input.availableCapabilities.map((capability) => ({ ...capability }));
    const request: IntelligenceRequest = {
      id: `intelligence-request-${stableIdentity({ task: input.task, objective: input.objective, concepts, capabilityIds: availableCapabilities.map(({ id }) => id), knowledgeContextId: knowledge?.knowledgeContextId, round: input.round ?? 1 })}`,
      task: input.task,
      objective: input.objective,
      intent: intent ? (structuredClone(intent) as StructuredIntent) : undefined,
      concepts,
      knowledgeContext: knowledge,
      bil,
      constraints: constraints.map((constraint) => ({ ...constraint })),
      availableCapabilities,
      requiredOutput: { ...input.requiredOutput, fields: [...input.requiredOutput.fields] },
      provenance: { ...input.provenance },
      previousObservations: input.previousObservations ? input.previousObservations.map((item) => ({ ...item })) : undefined,
    };
    return deepFreeze(structuredClone(request));
  }

  private compileKnowledge(input: ContextCompilationInput): IntelligenceKnowledgeContext {
    const context: KnowledgeContext = input.knowledgeContext!;
    const focusConcepts = new Set<string>([
      ...(input.intent?.concepts ?? []),
      ...(input.bilContext?.knowledgeRequirements.flatMap(({ declaration }) => declaration.concepts) ?? []),
      ...context.requirements.flatMap(({ concepts }) => concepts),
    ]);
    const wantedRelationships = new Set<string>(input.bilContext?.knowledgeRequirements.flatMap(({ declaration }) => declaration.relationshipTypes ?? []) ?? []);
    const concepts: IntelligenceKnowledgeConcept[] = context.concepts
      .map((concept) => ({
        id: concept.id,
        name: concept.name,
        definition: concept.content.definition,
        explanation: concept.content.explanation,
        examples: concept.content.examples,
        prerequisites: concept.content.prerequisites,
        sourceIds: sourceIdsFor(context, concept.id),
      }));
    const relationships = context.relationships
      .filter((relationship) => context.concepts.some(({ id }) => id === relationship.from) && context.concepts.some(({ id }) => id === relationship.to))
      .filter((relationship) => !wantedRelationships.size || wantedRelationships.has(relationship.type))
      .map((relationship) => ({
        id: relationship.id,
        type: relationship.type,
        from: relationship.from,
        to: relationship.to,
        evidenceReference: evidenceReference(relationship),
      }));
    const conceptIds = new Set(concepts.map(({ id }) => id));
    const relationshipIds = new Set(relationships.map(({ id }) => id));
    const facts = context.facts
      .filter((fact) => conceptIds.has(fact.subject))
      .map((fact) => {
        const sources = sourceIdsFor(context, fact.subject);
        return { subject: fact.subject, predicate: fact.predicate, value: structuredClone(fact.value), sourceId: sources[0] };
      });
    const sourceIds = unique([...concepts.flatMap(({ sourceIds: ids }) => ids ?? [])]).filter((id): id is string => Boolean(id));
    const unresolvedRequirementIds = [...context.unresolvedRequirementIds];
    const missing = (input.missingKnowledge ?? []).map((item) => ({ ...item }));
    const conflicts = context.conflicts
      .filter(({ subject, predicate }) => conceptIds.has(subject) || relationshipIds.has(subject))
      .map((conflict) => ({ id: conflict.id, subject: conflict.predicate ? `${conflict.subject}:${conflict.predicate}` : conflict.subject, candidateValues: conflict.candidates.map(({ value, sourceId }) => ({ value: structuredClone(value), sourceId })) }));
    return {
      knowledgeContextId: context.id,
      concepts,
      focusConceptIds: unique([...focusConcepts]).filter((id) => conceptIds.has(id)),
      relationships,
      facts,
      unresolvedRequirementIds: [...unresolvedRequirementIds, ...missing.map(({ requirementId }) => requirementId)],
      conflicts,
      sourceIds,
    };
  }

  private compileBil(context: BilContext): IntelligenceBilContext {
    return {
      contextId: context.id,
      sourceModules: context.sourceModules.map(({ id, version }) => ({ id, version })),
      requiredCapabilityIds: [...context.requiredCapabilityIds],
      knowledgeRequirementIds: context.knowledgeRequirements.map(({ declaration }) => declaration.id),
      constraints: context.constraints.map(({ declaration }) => ({ type: declaration.type, value: structuredClone(declaration.value), required: true })),
      verificationMethods: context.verificationRequirements.map(({ declaration }) => declaration.method),
      outputTypes: context.outputRequirements.map(({ declaration }) => declaration.type),
    };
  }
}

/** Builds the capability summaries Bikting is willing to show a provider. */
export function compileCapabilitySummaries(capabilities: readonly import("../capabilities/capability.types").Capability[]): IntelligenceCapabilitySummary[] {
  return capabilities
    .map((capability) => ({
      id: capability.id,
      description: capability.description,
      inputs: capability.inputs.map(({ name, type }) => `${name}:${type}`),
      outputs: capability.outputs.map(({ name, type }) => `${name}:${type}`),
      accessRequirement: capability.access?.requirement,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function sourceIdsFor(context: KnowledgeContext, conceptId: string): string[] {
  const sourceIds = new Set<string>();
  for (const artifact of context.artifacts) {
    if (artifact.concepts?.some((concept) => concept.id === conceptId)) sourceIds.add(artifact.sourceId);
  }
  return [...sourceIds].sort();
}

function evidenceReference(relationship: { metadata?: Record<string, unknown> }): string | undefined {
  const evidence = relationship.metadata?.knowledgeEvidence as { artifactId?: string } | undefined;
  return evidence?.artifactId;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  if (value.constructor?.name === "BiktingGraph") return value;
  for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  return Object.freeze(value);
}
