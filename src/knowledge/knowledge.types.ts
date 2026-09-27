import { Entity, ProvenanceRecord, Relationship } from "../core/types";

export interface KnowledgeConcept extends Entity {
  kind: "concept";
  content: {
    definition?: string;
    explanation?: string;
    examples?: string[];
    mechanisms?: string[];
    applications?: string[];
    prerequisites?: string[];
  };
}

export interface KnowledgeSequence {
  id: string;
  steps: Array<{
    conceptId: string;
    order: number;
    purpose?: string;
  }>;
}

export interface KnowledgeModule {
  id: string;
  name: string;
  domain?: string;
  concepts: KnowledgeConcept[];
  relationships: Relationship[];
  sequences?: KnowledgeSequence[];
  sources?: ProvenanceRecord[];
  evidence?: ProvenanceRecord[];
  metadata?: Record<string, unknown>;
}
