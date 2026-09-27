import { AuthorizationGrant, AuthorizationRequirement } from "../core/access";
import { ExecutionEvent } from "../execution/events";
import { ExecutionAttempt } from "../execution/execution.types";
import { Observation } from "../execution/observation.types";
import { UserIntent } from "../intent/intent.types";
import { VerificationResult } from "../execution/verifier";

export type ProjectStatus = "draft" | "active" | "blocked" | "completed" | "failed" | "cancelled";

export interface ArtifactReference {
  id: string;
  name: string;
  type: string;
  uri?: string;
  contentHash?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ProjectTaskState {
  taskId: string;
  status: "pending" | "running" | "blocked" | "completed" | "failed";
  executionAttemptIds?: string[];
  error?: { message: string; code?: string };
}

export interface ProjectState {
  id: string;
  originalIntent: UserIntent;
  currentObjective: string;
  status: ProjectStatus;
  planId?: string;
  tasks: ProjectTaskState[];
  providerSelections: Record<string, string>;
  authorizationRequirements: AuthorizationRequirement[];
  authorizationGrants: AuthorizationGrant[];
  artifacts: ArtifactReference[];
  executionAttempts: ExecutionAttempt[];
  observations: Observation[];
  verificationResults: VerificationResult[];
  events: ExecutionEvent[];
  errors: Array<{ message: string; code?: string; at: string }>;
  retries: Array<{ taskId: string; attempt: number; at: string; reason?: string }>;
  decisions: Array<{ at: string; decision: string; reason?: string }>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  metadata?: Record<string, unknown>;
}
