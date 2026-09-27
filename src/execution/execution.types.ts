import { ExecutionPlan, PlanStep } from "../planning/plan.types";
import { ExecutorKind } from "../providers/provider.types";

export interface ExecutionContext {
  plan: ExecutionPlan;
  results: Map<string, ExecutionResult>;
  metadata?: Record<string, unknown>;
}

export interface ExecutionResult {
  stepId: string;
  status: "completed" | "failed" | "blocked";
  output?: unknown;
  error?: { message: string; code?: string };
  provenance: {
    sourceType: "capability" | "adapter" | "engine";
    sourceId: string;
    observedAt: string;
  };
}

export interface ExecutionAttempt {
  id: string;
  projectId: string;
  taskId: string;
  planStepId: string;
  providerId: string;
  executorKind: ExecutorKind;
  attempt: number;
  status: "pending" | "running" | "completed" | "failed" | "blocked" | "cancelled";
  startedAt?: string;
  completedAt?: string;
  result?: ExecutionResult;
  error?: { message: string; code?: string };
  metadata?: Record<string, unknown>;
  runId?: string;
  planId?: string;
  capabilityId?: string;
  inputSummary?: { keys: string[] };
  resultReference?: string;
  provenance?: Array<{ sourceType: string; sourceId: string }>;
}

export interface CapabilityAdapter {
  capabilityId: string;
  execute(inputs: Record<string, unknown>, context: ExecutionContext): Promise<unknown>;
}

export type StepExecutor = (step: PlanStep, context: ExecutionContext) => Promise<ExecutionResult>;
