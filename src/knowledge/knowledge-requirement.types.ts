export type KnowledgeFreshness = "stable" | "recent" | "live" | "project_current";
export interface KnowledgeRequirement {
  id: string;
  domain?: string;
  concepts: string[];
  topic?: string;
  relationshipTypes?: string[];
  freshness: KnowledgeFreshness;
  minimumAuthority?: number;
  allowedSourceTypes?: string[];
  accessRequirementIds?: string[];
  requireProvenance?: boolean;
  minimumConfidence?: number;
  evidenceRequired?: boolean;
  required: boolean;
}
