import { CapabilityRegistry } from "../capabilities/capability.registry";
import { PreparedExecutionPlan } from "../planning/prepared-plan";
import { CapabilityProviderRegistry } from "../providers/provider.registry";
import { CanonicalProviderInvoker } from "./provider-invoker";

export interface ExecutionBlock { code: string; message: string; stepId?: string; }
export interface ExecutionGuardInput { prepared: PreparedExecutionPlan; stepId: string; completedStepIds: ReadonlySet<string>; inputs?: Readonly<Record<string, unknown>>; capabilities: CapabilityRegistry; providers: CapabilityProviderRegistry; invoker: CanonicalProviderInvoker; }
export type ExecutionGuardResult = { allowed: true; providerId: string } | { allowed: false; reasons: ExecutionBlock[] };

export function guardStepExecution(input: ExecutionGuardInput): ExecutionGuardResult {
  const reasons: ExecutionBlock[] = []; const { prepared } = input; const step = prepared.plan.steps.find(({ id }) => id === input.stepId);
  if (prepared.status !== "ready") reasons.push(block("plan_not_ready", `Prepared plan is ${prepared.status}.`, input.stepId));
  if (prepared.plan.status !== "ready") reasons.push(block("plan_not_ready", `Canonical plan is ${prepared.plan.status}.`, input.stepId));
  if (!step) return { allowed: false, reasons: [...reasons, block("unknown_step", "Plan step does not exist.", input.stepId)] };
  if (prepared.blockedStepIds.includes(step.id)) reasons.push(block("step_blocked", "The prepared plan marks this step blocked.", step.id));
  if ((step.dependsOn ?? []).some((id) => !input.completedStepIds.has(id))) reasons.push(block("dependency_incomplete", "A dependency has not completed successfully.", step.id));
  if (!step.capabilityId || !input.capabilities.has(step.capabilityId)) reasons.push(block("missing_capability", "The required capability is not registered.", step.id));
  const selection = prepared.providerSelections?.find(({ stepId }) => stepId === step.id);
  if (!selection?.providerId || selection.status !== "selected") reasons.push(block("provider_not_selected", "No provider was selected by policy.", step.id));
  const provider = selection?.providerId ? input.providers.get(selection.providerId) : undefined;
  if (!provider) reasons.push(block("unknown_provider", "The selected provider is not registered.", step.id));
  else { if (provider.availability !== "available") reasons.push(block("provider_unavailable", `Provider is ${provider.availability}.`, step.id)); if (step.capabilityId && !provider.capabilityIds.includes(step.capabilityId)) reasons.push(block("unsupported_capability", "Selected provider does not support the capability.", step.id)); if (step.capabilityId && !input.invoker.has(provider.id, step.capabilityId)) reasons.push(block("provider_not_executable", "Selected provider is not enabled at the canonical invocation boundary.", step.id)); }
  const authorization = prepared.authorization.steps.find(({ stepId }) => stepId === step.id);
  if (!authorization || authorization.status !== "authorized" || (selection?.providerId && !authorization.authorizedProviderIds.includes(selection.providerId))) reasons.push(block("authorization_invalid", "Selected provider is not currently authorized.", step.id));
  for (const expected of step.expectedInputs ?? []) if (expected.required && !Object.prototype.hasOwnProperty.call(input.inputs ?? {}, expected.name)) reasons.push(block("missing_input", `Required input ${expected.name} is missing.`, step.id));
  for (const requirement of step.executionRequirements ?? []) if (requirement.required && !["structured_input", "dependency_order", "deterministic_providers", "no_external_network"].includes(requirement.type)) reasons.push(block("unsupported_execution_requirement", `Execution requirement ${requirement.type} is unsupported.`, step.id));
  if ((step.executionRequirements ?? []).some(({ required, type }) => required && type === "deterministic_providers") && provider?.executorKind !== "deterministic") reasons.push(block("non_deterministic_provider", "A deterministic provider is required.", step.id));
  return reasons.length ? { allowed: false, reasons } : { allowed: true, providerId: selection!.providerId! };
}
function block(code: string, message: string, stepId?: string): ExecutionBlock { return { code, message, stepId }; }
