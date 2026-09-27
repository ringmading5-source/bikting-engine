import { ExecutionResult } from "./execution.types";

export type VerificationStatus = "PASS" | "FAIL" | "PARTIAL" | "REQUIRES_USER" | "RETRYABLE" | "UNSUPPORTED" | "NOT_APPLICABLE";

export interface VerificationResult {
  id: string;
  status: VerificationStatus;
  method: string;
  evidence?: unknown[];
  reason?: string;
  taskId?: string;
  executionAttemptId?: string;
  verifiedAt: string;
  metadata?: Record<string, unknown>;
}

export interface Verifier {
  verify(result: ExecutionResult): Promise<VerificationResult>;
}

export class StatusVerifier implements Verifier {
  async verify(result: ExecutionResult): Promise<VerificationResult> {
    const status: VerificationStatus = result.status === "completed" ? "PASS" : result.status === "blocked" ? "RETRYABLE" : "FAIL";
    return {
      id: `verification-${result.stepId}`,
      status,
      method: "execution_status",
      evidence: result.output === undefined ? [] : [result.output],
      reason: result.error?.message,
      taskId: result.stepId,
      verifiedAt: new Date().toISOString(),
    };
  }
}
