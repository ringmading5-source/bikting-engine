import { Relationship } from "../core/types";
import { KnowledgeConcept, KnowledgeModule } from "./knowledge.types";
import { KnowledgeFreshness, KnowledgeRequirement } from "./knowledge-requirement.types";

export type KnowledgeSourceType = "structured" | "document" | "dataset" | "graph" | "model" | "search" | "api" | "database" | "project" | "user_file";
export type KnowledgeSourceAvailability = "available" | "unavailable" | "degraded" | "unknown";
export interface KnowledgeSource {
  id: string; name: string; type: KnowledgeSourceType; domains: string[]; conceptIds?: string[]; relationshipTypes?: string[];
  freshness: KnowledgeFreshness[]; authority?: { level: number; description?: string }; accessRequirementIds?: string[];
  confidence?: number; provenanceCharacteristics?: { traceable: boolean; evidence: boolean };
  availability: KnowledgeSourceAvailability; retrievalKind: "static" | "document" | "knowledge_module" | "future_remote";
  provenance?: { publisher?: string; citation?: string; metadata?: Record<string, unknown> }; metadata?: Record<string, unknown>;
}
export interface KnowledgeSourceContribution { sourceId: string; coveredConceptIds: string[]; coveredRelationshipTypes: string[]; }
export interface KnowledgeSourceResolution { requirementId: string; candidateSourceIds: string[]; eligibleSourceIds: string[]; unavailableSourceIds: string[]; accessBlockedSourceIds: string[]; incompatibleSourceIds: string[]; freshnessMismatchSourceIds: string[]; contributions: KnowledgeSourceContribution[]; uncoveredConceptIds: string[]; uncoveredRelationshipTypes: string[]; unresolved: boolean; reason: string; provenance: Array<{ sourceId: string; reason: string }>; }
export interface KnowledgeResolution { id: string; requirements: KnowledgeRequirement[]; entries: KnowledgeSourceResolution[]; unresolvedRequirementIds: string[]; }
export interface KnowledgeFact { subject: string; predicate?: string; value: unknown; confidence?: number; }
export interface KnowledgeArtifact {
  id: string; retrievalId: string; sourceId: string; requirementId: string; contentType: "structured" | "document" | "dataset" | "graph" | "module";
  concepts?: KnowledgeConcept[]; facts?: KnowledgeFact[]; relationships?: Relationship[]; evidence?: Array<{ type: string; value: unknown }>;
  freshness: KnowledgeFreshness; retrievedAt: string; provenance: Array<{ sourceId: string; requirementId: string; citation?: string; moduleId?: string }>;
  metadata?: Record<string, unknown>;
}
export interface KnowledgeRetrievalRequest { retrievalId: string; requirement: KnowledgeRequirement; source: KnowledgeSource; projectContext?: Record<string, unknown>; }
export interface StaticKnowledgePayload { contentType: KnowledgeArtifact["contentType"]; concepts?: KnowledgeConcept[]; facts?: KnowledgeFact[]; relationships?: Relationship[]; evidence?: KnowledgeArtifact["evidence"]; module?: KnowledgeModule; metadata?: Record<string, unknown>; }
