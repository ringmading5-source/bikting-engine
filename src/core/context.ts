import { EntityId } from "./types";

/** Mutable task-scoped state. Long-term memory remains a separate concern. */
export interface BiktingContext {
  currentIntentId?: string;
  currentProjectId?: EntityId;
  currentWorkspaceId?: EntityId;
  currentTaskId?: EntityId;
  completedStepIds: string[];
  failedStepIds: string[];
  availableResourceIds: EntityId[];
  connectedServiceIds: EntityId[];
  userConstraints: Record<string, unknown>;
  decisions: Array<{ at: string; decision: string; reason?: string }>;
}

export function createContext(): BiktingContext {
  return { completedStepIds: [], failedStepIds: [], availableResourceIds: [], connectedServiceIds: [], userConstraints: {}, decisions: [] };
}
