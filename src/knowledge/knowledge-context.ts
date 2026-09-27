import { BiktingGraph } from "../core/graph";
import { RelationshipTypeRegistry } from "../core/relationship.registry";
import { Relationship } from "../core/types";
import { KnowledgeConcept } from "./knowledge.types";
import { KnowledgeRequirement } from "./knowledge-requirement.types";
import { KnowledgeArtifact, KnowledgeFact, KnowledgeResolution } from "./knowledge-source.types";
import type { SemanticConceptSet } from "./semantic-concepts";
import type { RelationshipRequirement } from "./relationship-discovery";
import type { DiscoveryRound, KnowledgeDiscoveryStopReason, KnowledgeGap, KnowledgeSufficiencyResult } from "./knowledge-discovery.types";

export interface KnowledgeConflict { id: string; subject: string; predicate?: string; candidates: Array<{ value: unknown; sourceId: string; artifactId: string; requirementId: string }>; }
export interface KnowledgeContextProvenance { sourceId: string; artifactId: string; retrievalId: string; requirementId: string; freshness: string; }
export interface KnowledgeContext {
  readonly id: string; readonly requirements: readonly Readonly<KnowledgeRequirement>[]; readonly artifacts: readonly Readonly<KnowledgeArtifact>[];
  readonly concepts: readonly Readonly<KnowledgeConcept>[]; readonly facts: readonly Readonly<KnowledgeFact>[]; readonly relationships: readonly Readonly<Relationship>[];
  readonly evidence: readonly unknown[]; readonly sourceIds: readonly string[]; readonly unresolvedRequirementIds: readonly string[];
  readonly conflicts: readonly Readonly<KnowledgeConflict>[]; readonly freshness: readonly string[]; readonly provenance: readonly Readonly<KnowledgeContextProvenance>[]; readonly graph: BiktingGraph;
  readonly semanticConceptSet?: SemanticConceptSet; readonly relationshipRequirements?: readonly RelationshipRequirement[]; readonly gaps?: readonly KnowledgeGap[]; readonly discoveryRounds?: readonly DiscoveryRound[]; readonly discoveryStopReason?: KnowledgeDiscoveryStopReason; readonly sufficiency?: KnowledgeSufficiencyResult;
}

export function normalizeKnowledgeContext(resolution: KnowledgeResolution, artifacts: readonly KnowledgeArtifact[], relationshipTypes: RelationshipTypeRegistry): KnowledgeContext {
  const ordered = [...artifacts].sort((a, b) => a.id.localeCompare(b.id)); const concepts = uniqueBy(ordered.flatMap(({ concepts = [] }) => concepts), ({ id }) => id); const relationships = uniqueBy(ordered.flatMap(({ relationships = [] }) => relationships), ({ id }) => id);
  for (const relationship of relationships) relationshipTypes.assert(relationship.type);
  const facts = uniqueBy(ordered.flatMap(({ facts = [] }) => facts), (fact) => stableStringify(fact)); const conflicts = conflictsFor(ordered); const graph = new BiktingGraph(); concepts.forEach((concept) => graph.addEntity(structuredClone(concept))); relationships.forEach((relationship) => graph.addRelationship(structuredClone(relationship))); graph.seal();
  const provenance = ordered.flatMap((artifact) => artifact.provenance.map(() => ({ sourceId: artifact.sourceId, artifactId: artifact.id, retrievalId: artifact.retrievalId, requirementId: artifact.requirementId, freshness: artifact.freshness })));
  const base = { requirements: structuredClone(resolution.requirements), artifacts: structuredClone(ordered), concepts: structuredClone(concepts), facts: structuredClone(facts), relationships: structuredClone(relationships), evidence: structuredClone(ordered.flatMap(({ evidence = [] }) => evidence)), sourceIds: [...new Set(ordered.map(({ sourceId }) => sourceId))].sort(), unresolvedRequirementIds: [...resolution.unresolvedRequirementIds], conflicts, freshness: [...new Set(ordered.map(({ freshness }) => freshness))].sort(), provenance };
  const context: KnowledgeContext = { id: `knowledge-context-${hash(stableStringify(base))}`, ...base, graph }; return deepFreeze(context);
}
function conflictsFor(artifacts: KnowledgeArtifact[]): KnowledgeConflict[] { const claims = new Map<string, Array<{ value: unknown; sourceId: string; artifactId: string; requirementId: string }>>(); for (const artifact of artifacts) for (const fact of artifact.facts ?? []) { const key = `${fact.subject}:${fact.predicate ?? "value"}`; const values = claims.get(key) ?? []; values.push({ value: structuredClone(fact.value), sourceId: artifact.sourceId, artifactId: artifact.id, requirementId: artifact.requirementId }); claims.set(key, values); } return [...claims.entries()].flatMap(([key, candidates]) => new Set(candidates.map(({ value }) => stableStringify(value))).size > 1 ? [{ id: `knowledge-conflict-${hash(key)}`, subject: key.split(":")[0], predicate: key.split(":").slice(1).join(":"), candidates: candidates.sort((a, b) => a.sourceId.localeCompare(b.sourceId)) }] : []).sort((a, b) => a.id.localeCompare(b.id)); }
function uniqueBy<T>(items: T[], key: (item: T) => string): T[] { return [...new Map(items.map((item) => [key(item), item])).values()].sort((a, b) => key(a).localeCompare(key(b))); }
function stableStringify(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`; return JSON.stringify(value); }
function hash(value: string): string { let result = 2166136261; for (let i = 0; i < value.length; i++) { result ^= value.charCodeAt(i); result = Math.imul(result, 16777619); } return (result >>> 0).toString(16).padStart(8, "0"); }
function deepFreeze<T>(value: T): T { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; if (value instanceof BiktingGraph) return value; for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item); return Object.freeze(value); }
