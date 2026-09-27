import { PlanVerificationRequirement } from "../planning/plan.types";
import { Observation } from "./observation.types";
import { VerificationResult } from "./verifier";
// The active safe evaluator is JavaScript and intentionally remains the single arithmetic implementation.
// @ts-expect-error The legacy module has no declaration file; its narrow call contract is enforced here.
import { evaluateExpression } from "../bikting/core/execution/SafeExpression.js";

const supported = new Set(["deterministic_result_check", "expression_satisfaction", "equation_satisfaction"]);
export function verifyObservation(requirement: PlanVerificationRequirement, observation: Observation, inputs: Readonly<Record<string, unknown>>, verifiedAt = "1970-01-01T00:00:00.000Z"): VerificationResult {
  const base = { id: `verification-${observation.executionAttemptId}-${requirement.id}`, method: requirement.method, taskId: observation.taskId, executionAttemptId: observation.executionAttemptId, verifiedAt, metadata: { requirementId: requirement.id, provenance: requirement.provenance } };
  if (!supported.has(requirement.method)) return { ...base, status: "UNSUPPORTED", evidence: [], reason: `Verification method ${requirement.method} is not implemented.` };
  const output = observation.observedState as Record<string, unknown>;
  if (!output || typeof output !== "object" || output.success === false) return { ...base, status: "FAIL", evidence: [], reason: "Provider execution did not produce a successful observation." };
  const result = numericResult(output.output);
  if (result === undefined) return { ...base, status: "FAIL", evidence: [], reason: "Observation has no numeric result." };
  if (requirement.method === "deterministic_result_check") {
    if (typeof inputs.expectedResult !== "number") return { ...base, status: "UNSUPPORTED", evidence: [result], reason: "Deterministic result verification requires an explicit expectedResult input." };
    const pass = Object.is(result, inputs.expectedResult); return { ...base, status: pass ? "PASS" : "FAIL", evidence: [{ expected: inputs.expectedResult, actual: result }], reason: pass ? "Observed result matches the declared expected result." : "Observed result differs from the declared expected result." };
  }
  if (typeof inputs.expression !== "string") return { ...base, status: "FAIL", evidence: [result], reason: "Expression input is missing." };
  try { const expected = evaluateExpression(inputs.expression, isRecord(inputs.variables) ? inputs.variables : {}); const pass = Object.is(result, expected); return { ...base, status: pass ? "PASS" : "FAIL", evidence: [{ expected, actual: result }], reason: pass ? "Observed result satisfies the expression." : "Observed result does not satisfy the expression." }; }
  catch (error) { return { ...base, status: "FAIL", evidence: [result], reason: error instanceof Error ? error.message : String(error) }; }
}
function numericResult(value: unknown): number | undefined { if (typeof value === "number" && Number.isFinite(value)) return value; if (isRecord(value) && typeof value.numericResult === "number" && Number.isFinite(value.numericResult)) return value.numericResult; return undefined; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
