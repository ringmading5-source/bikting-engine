import { RelationshipTypeRegistry } from "../core/relationship.registry";
import { Relationship } from "../core/types";
import { UserIntent } from "../intent/intent.types";
import { BilCompiledRequirement } from "../bil/bil.types";
import { KnowledgeRequirement } from "./knowledge-requirement.types";
import { KnowledgeArtifact } from "./knowledge-source.types";
import { SemanticConceptSet } from "./semantic-concepts";

export interface RelationshipRequirement { id: string; from: string; to: string; acceptableTypes: string[]; direction: "directed" | "either"; match: "direct" | "path"; evidenceRequired: boolean; required: boolean; status: "pending" | "satisfied" | "unresolved"; provenance: Array<{ sourceType: "intent" | "bil" | "gap"; sourceId: string }>; }
export interface RelationshipRequirementGenerator { readonly id: string; generate(intent: UserIntent, concepts: SemanticConceptSet, bilRequirements: readonly BilCompiledRequirement<KnowledgeRequirement>[], relationshipTypes: RelationshipTypeRegistry): RelationshipRequirement[]; }
export class DeterministicRelationshipRequirementGenerator implements RelationshipRequirementGenerator {
  readonly id = "deterministic-relationship-requirements";
  generate(intent: UserIntent, concepts: SemanticConceptSet, bilRequirements: readonly BilCompiledRequirement<KnowledgeRequirement>[], types: RelationshipTypeRegistry): RelationshipRequirement[] {
    const explicit = intent.context?.relationshipGoals; const result: RelationshipRequirement[] = [];
    if (Array.isArray(explicit)) for (const [index, value] of explicit.entries()) if (isRecord(value) && typeof value.from === "string" && typeof value.to === "string") result.push(requirement(`relationship-intent-${index}`, value.from, value.to, strings(value.acceptableTypes), value.match === "direct" ? "direct" : "path", value.evidenceRequired !== false, value.required !== false, { sourceType: "intent", sourceId: `context.relationshipGoals.${index}` }, types));
    // Bil knowledge requirements declare which concepts must be covered, not that they form a single
    // causal chain. Deriving a path requirement from their concept list over-constrains retrieval and
    // produces unsatisfiable relationship gaps, so only explicit intent goals and the causal fallback
    // below create relationship requirements.
    void bilRequirements;
    if (!result.length) { const ids = concepts.concepts.filter(({ kind }) => kind !== "event" && kind !== "constraint").map(({ id }) => id); if (ids.length > 1 && (intent.actions ?? []).some((action) => ["explain", "cause"].includes(action))) result.push(requirement("relationship-intent-causal", ids[0], ids.at(-1)!, ["causes", "produces", "flows_to", "interacts_with"], "path", true, true, { sourceType: "intent", sourceId: "actions" }, types)); }
    return [...new Map(result.map((item) => [item.id, item])).values()].sort((a, b) => a.id.localeCompare(b.id));
  }
}
export interface RelationshipExtractor { readonly id: string; extract(artifacts: readonly KnowledgeArtifact[], relationshipTypes: RelationshipTypeRegistry): Relationship[]; }
export class StructuredArtifactRelationshipExtractor implements RelationshipExtractor {
  readonly id = "structured-artifact-relationships";
  extract(artifacts: readonly KnowledgeArtifact[], types: RelationshipTypeRegistry): Relationship[] { return artifacts.flatMap((artifact) => (artifact.relationships ?? []).map((relationship) => { types.assert(relationship.type); return { ...structuredClone(relationship), metadata: { ...(relationship.metadata ?? {}), knowledgeEvidence: { artifactId: artifact.id, retrievalId: artifact.retrievalId, sourceId: artifact.sourceId, requirementId: artifact.requirementId } }, source: artifact.sourceId }; })).sort((a, b) => a.id.localeCompare(b.id)); }
}
function requirement(id: string, from: string, to: string, acceptableTypes: string[], match: "direct" | "path", evidenceRequired: boolean, required: boolean, provenance: RelationshipRequirement["provenance"][number], types: RelationshipTypeRegistry): RelationshipRequirement { acceptableTypes.forEach((type) => types.assert(type)); return { id, from, to, acceptableTypes: [...new Set(acceptableTypes)].sort(), direction: "directed", match, evidenceRequired, required, status: "pending", provenance: [provenance] }; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
