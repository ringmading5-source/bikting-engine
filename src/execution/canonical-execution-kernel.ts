import { AuthorizationGrant } from "../core/access";
import { evaluatePlanAuthorization } from "../core/authorization";
import { CapabilityRegistry } from "../capabilities/capability.registry";
import { PreparedExecutionPlan } from "../planning/prepared-plan";
import { CapabilityProviderRegistry } from "../providers/provider.registry";
import { InMemoryExecutionEventLog } from "./event-log";
import { ExecutionEvent } from "./events";
import { ExecutionAttempt } from "./execution.types";
import { guardStepExecution, ExecutionBlock } from "./execution-guard";
import { projectCanonicalExecutionState, CanonicalExecutionState, CanonicalStepState } from "./execution-state";
import { resolveStepInputBindings } from "./input-binding.resolver";
import { Observation } from "./observation.types";
import { CanonicalProviderInvoker } from "./provider-invoker";
import { verifyObservation } from "./deterministic-verifier";
import { VerificationResult } from "./verifier";
import { validateCanonicalPlan } from "../bil/bil.planning.adapter";

export interface CanonicalExecutionKernelInput { preparedPlan: PreparedExecutionPlan; projectId: string; runId?: string; context?: Record<string, unknown>; authorizationGrants?: readonly AuthorizationGrant[]; onEvent?: (event: ExecutionEvent) => void; }
export interface CanonicalStepExecutionResult { stepId: string; status: CanonicalStepState; invocationStatus: "not_invoked" | "completed" | "failed"; providerId?: string; resolvedInputs?: Readonly<Record<string, unknown>>; output?: unknown; observationId?: string; verificationResultIds: string[]; failures: ExecutionBlock[]; }
export interface CanonicalExecutionResult { runId: string; planId: string; status: "completed" | "failed" | "blocked"; stepResults: CanonicalStepExecutionResult[]; attempts: ExecutionAttempt[]; observations: Observation[]; verificationResults: VerificationResult[]; blockedStepIds: string[]; failures: ExecutionBlock[]; outputs: Record<string, unknown>; events: ExecutionEvent[]; state: CanonicalExecutionState; provenance: PreparedExecutionPlan["provenance"]; }

/** The sole opt-in execution composition root for canonical prepared plans. */
export class CanonicalExecutionKernel {
  constructor(private readonly capabilities: CapabilityRegistry, private readonly providers: CapabilityProviderRegistry, private readonly invoker: CanonicalProviderInvoker) {}

  async execute(input: CanonicalExecutionKernelInput): Promise<CanonicalExecutionResult> {
    validateCanonicalPlan(input.preparedPlan.plan);
    const prepared = input.authorizationGrants ? { ...input.preparedPlan, authorization: evaluatePlanAuthorization(input.preparedPlan.providerResolution, input.authorizationGrants) } : input.preparedPlan;
    const runId = input.runId ?? `execution-${hash(stableStringify({ preparedPlanId: prepared.id, projectId: input.projectId, context: input.context ?? {} }))}`; const log = new InMemoryExecutionEventLog(runId, undefined, input.onEvent);
    const attempts: ExecutionAttempt[] = [], observations: Observation[] = [], verificationResults: VerificationResult[] = [], stepResults: CanonicalStepExecutionResult[] = [], outputs = new Map<string, unknown>(), completed = new Set<string>();
    log.append({ type: "execution_started", projectId: input.projectId, data: { planId: prepared.plan.id, preparedPlanId: prepared.id } });
    const pending = new Map(prepared.plan.steps.map((step) => [step.id, step]));
    while (pending.size) {
      const candidates = [...pending.values()].filter((step) => (step.dependsOn ?? []).every((id) => !pending.has(id)));
      if (!candidates.length) throw new Error("Prepared plan contains an invariant-breaking dependency cycle.");
      for (const step of candidates) {
        const failedDependencies = (step.dependsOn ?? []).filter((id) => !completed.has(id));
        if (failedDependencies.length) { const failures = [block("dependency_failed", `Dependencies did not succeed: ${failedDependencies.join(", ")}.`, step.id)]; log.append({ type: "step_blocked", projectId: input.projectId, taskId: step.id, data: { planId: prepared.plan.id, reasons: failures.map(({ code }) => code) } }); stepResults.push({ stepId: step.id, status: "blocked", invocationStatus: "not_invoked", verificationResultIds: [], failures }); pending.delete(step.id); continue; }
        log.append({ type: "step_ready", projectId: input.projectId, taskId: step.id, data: { planId: prepared.plan.id, capabilityId: step.capabilityId } });
        const binding = resolveStepInputBindings(step, { intent: prepared.plan.originatingIntent as unknown as Record<string, unknown> | undefined, context: input.context, stepOutputs: outputs });
        if (binding.status === "unresolved") { const failures = binding.failures.map(({ code, message }) => block(code, message, step.id)); log.append({ type: "step_blocked", projectId: input.projectId, taskId: step.id, data: { planId: prepared.plan.id, reasons: failures.map(({ code }) => code) } }); stepResults.push({ stepId: step.id, status: "blocked", invocationStatus: "not_invoked", verificationResultIds: [], failures }); pending.delete(step.id); continue; }
        log.append({ type: "input_bindings_resolved", projectId: input.projectId, taskId: step.id, data: { planId: prepared.plan.id, inputKeys: Object.keys(binding.inputs).sort() } });
        const guard = guardStepExecution({ prepared, stepId: step.id, completedStepIds: completed, inputs: binding.inputs, capabilities: this.capabilities, providers: this.providers, invoker: this.invoker });
        if (!guard.allowed) { log.append({ type: "step_blocked", projectId: input.projectId, taskId: step.id, data: { planId: prepared.plan.id, reasons: guard.reasons.map(({ code }) => code) } }); stepResults.push({ stepId: step.id, status: "blocked", invocationStatus: "not_invoked", resolvedInputs: binding.inputs, verificationResultIds: [], failures: guard.reasons }); pending.delete(step.id); continue; }
        const provider = this.providers.get(guard.providerId)!; const attemptId = `${runId}:${step.id}:attempt-1`; const attempt: ExecutionAttempt = { id: attemptId, projectId: input.projectId, taskId: step.id, planStepId: step.id, providerId: provider.id, executorKind: provider.executorKind, attempt: 1, status: "running", startedAt: timestamp(), runId, planId: prepared.plan.id, capabilityId: step.capabilityId, inputSummary: { keys: Object.keys(binding.inputs).sort() }, provenance: [{ sourceType: "plan", sourceId: prepared.plan.id }, { sourceType: "provider", sourceId: provider.id }] }; attempts.push(attempt);
        log.append({ type: "step_started", projectId: input.projectId, taskId: step.id, providerId: provider.id, data: { planId: prepared.plan.id, capabilityId: step.capabilityId, attemptId } }); log.append({ type: "provider_invoked", projectId: input.projectId, taskId: step.id, providerId: provider.id, data: { planId: prepared.plan.id, capabilityId: step.capabilityId, attemptId } });
        try {
          const raw = await this.invoker.invoke({ runId, planId: prepared.plan.id, stepId: step.id, capabilityId: step.capabilityId!, providerId: provider.id, input: binding.inputs }); const output = structuredClone(raw);
          // Declared properties are only a claim until the observed result satisfies them.
          for (const expected of provider.properties?.outputs ?? []) {
            const value = output && typeof output === "object" && !Array.isArray(output) ? (output as Record<string, unknown>)[expected.name] : undefined;
            if (!matchesOutput(value, expected.type)) throw new Error(`Provider output ${expected.name} does not match declared type ${expected.type}.`);
          }
          outputs.set(step.id, output);
          attempt.status = "completed"; attempt.completedAt = timestamp(); attempt.resultReference = `output:${step.id}`; attempt.result = { stepId: step.id, status: "completed", output: structuredClone(output), provenance: { sourceType: "capability", sourceId: provider.id, observedAt: timestamp() } };
          log.append({ type: "provider_completed", projectId: input.projectId, taskId: step.id, providerId: provider.id, data: { planId: prepared.plan.id, attemptId, outputType: outputType(output) } });
          const observation: Observation = { id: `observation-${attemptId}`, taskId: step.id, executionAttemptId: attemptId, providerId: provider.id, observedAt: timestamp(), observedState: { success: true, output: structuredClone(output) }, metadata: { capabilityId: step.capabilityId, planId: prepared.plan.id, provenance: step.provenance } }; observations.push(observation);
          log.append({ type: "observation_recorded", projectId: input.projectId, taskId: step.id, providerId: provider.id, data: { planId: prepared.plan.id, observationId: observation.id, attemptId } });
          const requirements = step.verificationRequirements ?? []; let verified = true;
          for (const requirement of requirements) { log.append({ type: "verification_started", projectId: input.projectId, taskId: step.id, data: { planId: prepared.plan.id, requirementId: requirement.id } }); const verification = verifyObservation(requirement, observation, binding.inputs); verificationResults.push(verification); log.append({ type: "verification_completed", projectId: input.projectId, taskId: step.id, data: { planId: prepared.plan.id, verificationId: verification.id, requirementId: requirement.id, status: verification.status } }); if (requirement.required && verification.status !== "PASS") verified = false; }
          const status: CanonicalStepState = verified ? "verified" : "failed"; const failures = verified ? [] : [block("verification_not_passed", "A required verification did not pass.", step.id)];
          if (verified) { completed.add(step.id); log.append({ type: "step_succeeded", projectId: input.projectId, taskId: step.id, data: { planId: prepared.plan.id, verified: true } }); } else log.append({ type: "step_failed", projectId: input.projectId, taskId: step.id, data: { planId: prepared.plan.id, reason: "verification_not_passed" } });
          stepResults.push({ stepId: step.id, status, invocationStatus: "completed", providerId: provider.id, resolvedInputs: binding.inputs, output, observationId: observation.id, verificationResultIds: verificationResults.filter(({ taskId }) => taskId === step.id).map(({ id }) => id), failures });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error); attempt.status = "failed"; attempt.completedAt = timestamp(); attempt.error = { message, code: "provider_failure" }; attempt.result = { stepId: step.id, status: "failed", error: { message, code: "provider_failure" }, provenance: { sourceType: "capability", sourceId: provider.id, observedAt: timestamp() } };
          log.append({ type: "provider_failed", projectId: input.projectId, taskId: step.id, providerId: provider.id, data: { planId: prepared.plan.id, attemptId, code: "provider_failure" } });
          const observation: Observation = { id: `observation-${attemptId}`, taskId: step.id, executionAttemptId: attemptId, providerId: provider.id, observedAt: timestamp(), observedState: { success: false, error: { message, code: "provider_failure" } }, metadata: { capabilityId: step.capabilityId, planId: prepared.plan.id, provenance: step.provenance } }; observations.push(observation); log.append({ type: "observation_recorded", projectId: input.projectId, taskId: step.id, providerId: provider.id, data: { planId: prepared.plan.id, observationId: observation.id, attemptId, success: false } }); log.append({ type: "step_failed", projectId: input.projectId, taskId: step.id, data: { planId: prepared.plan.id, reason: "provider_failure" } });
          stepResults.push({ stepId: step.id, status: "failed", invocationStatus: "failed", providerId: provider.id, resolvedInputs: binding.inputs, observationId: observation.id, verificationResultIds: [], failures: [block("provider_failure", message, step.id)] });
        }
        pending.delete(step.id);
      }
    }
    const failures = stepResults.flatMap(({ failures }) => failures); const blockedStepIds = stepResults.filter(({ status }) => status === "blocked").map(({ stepId }) => stepId); const success = stepResults.length === prepared.plan.steps.length && stepResults.every(({ status }) => status === "verified" || status === "succeeded"); const status = success ? "completed" : stepResults.some(({ status }) => status === "failed") ? "failed" : "blocked";
    log.append({ type: success ? "execution_completed" : "execution_failed", projectId: input.projectId, data: { planId: prepared.plan.id, status, blockedStepIds } }); const events = log.list();
    return { runId, planId: prepared.plan.id, status, stepResults, attempts: structuredClone(attempts), observations: structuredClone(observations), verificationResults: structuredClone(verificationResults), blockedStepIds, failures, outputs: Object.fromEntries([...outputs.entries()].map(([id, value]) => [id, structuredClone(value)])), events, state: projectCanonicalExecutionState(events), provenance: [...prepared.provenance] };
  }
}
function block(code: string, message: string, stepId?: string): ExecutionBlock { return { code, message, stepId }; }
function timestamp(): string { return "1970-01-01T00:00:00.000Z"; }
function outputType(value: unknown): string { return value === null ? "null" : Array.isArray(value) ? "array" : typeof value; }
function matchesOutput(value: unknown, type: string): boolean {
  if (value === undefined || value === null) return false;
  if (type === "number" || type === "numeric_result") return typeof value === "number" && Number.isFinite(value);
  if (type === "string" || type === "text") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean";
  if (type === "workspace_files") return typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0 && Object.values(value).every((item) => typeof item === "string");
  if (type === "numeric_data") return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item));
  return true; // Unknown types still require presence; specialized validators must be registered separately.
}
function stableStringify(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`; return JSON.stringify(value); }
function hash(value: string): string { let result = 2166136261; for (let index = 0; index < value.length; index += 1) { result ^= value.charCodeAt(index); result = Math.imul(result, 16777619); } return (result >>> 0).toString(16).padStart(8, "0"); }
