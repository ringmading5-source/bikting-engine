import { ArtifactReference } from "../projects/project.types";

/** Independently recorded post-execution state, separate from executor output. */
export interface Observation {
  id: string;
  taskId?: string;
  executionAttemptId: string;
  providerId?: string;
  observedAt: string;
  observedState: unknown;
  artifacts?: ArtifactReference[];
  evidence?: unknown[];
  metadata?: Record<string, unknown>;
}
