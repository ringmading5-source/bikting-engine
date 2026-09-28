import type { SearchResult } from "../search/search.types";

export interface TokenBudget {
  maxInputTokens: number;
  maxOutputTokens: number;
  maxAttempts: number;
  maxEstimatedCost: number;
}

export interface ContextPackage {
  taskId: string;
  items: readonly { id: string; content: unknown; source: string; estimatedTokens: number }[];
  estimatedTokens: number;
  omittedIds: readonly string[];
}

export interface WorkerTask {
  id: string;
  projectId: string;
  parentTaskId?: string;
  objective: string;
  requiredCapability: "code" | "reason" | "classify" | "summarize" | "vision";
  requirements?: { coding?: "low" | "medium" | "high"; reasoning?: "low" | "medium" | "high"; structuredOutput?: boolean };
  inputs: Record<string, unknown>;
  evidence: readonly SearchResult[];
  constraints: readonly string[];
  outputSchema?: { required?: readonly string[]; type?: "object" | "string" };
  acceptanceCriteria: readonly string[];
  tokenBudget: TokenBudget;
  retryPolicy: { allowTargetedRepair: boolean; allowEscalation: boolean };
}

export interface ValidationResult {
  valid: boolean;
  issues: readonly { code: string; message: string; path?: string }[];
  method: string;
}

export interface ExecutionTelemetry {
  provider: string;
  model: string;
  taskId: string;
  inputTokensEstimated: number;
  inputTokensActual?: number;
  outputTokens: number;
  estimatedCost: number | null;
  actualCost?: number;
  latencyMs: number;
  attempt: number;
  validationResult: "passed" | "failed";
  escalationReason?: string;
}

export interface WorkerPrompt {
  role: string;
  taskId: string;
  objective: string;
  context: ContextPackage;
  evidence: readonly { id: string; source: string; provenance: string }[];
  constraints: readonly string[];
  requiredOutput: WorkerTask["outputSchema"];
  acceptanceCriteria: readonly string[];
  maxInputTokens: number;
  maxOutputTokens: number;
}

export interface WorkerResponse {
  output: unknown;
  inputTokens?: number;
  outputTokens?: number;
  actualCost?: number;
}
