/**
 * Shared architecture types for the next TypeScript migration of Bikting's core.
 * This declaration has no runtime dependency and does not alter the current
 * JavaScript execution engine.
 */

export type EntityId = string;

export type EntityKind =
  | "concept"
  | "knowledge"
  | "capability"
  | "module"
  | "framework"
  | "library"
  | "api"
  | "tool"
  | "model"
  | "environment"
  | "resource"
  | "workflow"
  | "task"
  | "project";

export interface Entity {
  id: EntityId;
  kind: EntityKind;
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProvenanceRecord {
  source: string;
  retrievedAt?: string;
  evidence?: string;
  metadata?: Record<string, unknown>;
}

export interface Relationship {
  id: string;
  type: string;
  from: EntityId;
  to: EntityId;
  weight?: number;
  metadata?: Record<string, unknown>;
  source?: string;
}

export interface GraphNode {
  entity: Entity;
  relationships: Relationship[];
}
