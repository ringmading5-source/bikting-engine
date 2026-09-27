import { PlanAuthorizationEvaluation } from "../core/authorization";
import { PreparedExecutionPlan } from "../planning/prepared-plan";
import { PlanProviderResolution } from "./provider.resolver";
import { PlanStep } from "../planning/plan.types";

export interface ProviderSelection { stepId: string; providerId?: string; status: "selected" | "unresolved" | "blocked"; reason: string; }
export interface ProviderSelectionPolicyInput { step: PlanStep; providerResolution: PlanProviderResolution; authorization: PlanAuthorizationEvaluation; policyContext?: Record<string, unknown>; }
export interface ProviderSelectionPolicy { readonly id: string; select(input: ProviderSelectionPolicyInput): ProviderSelection; }

export class SingleAuthorizedProviderPolicy implements ProviderSelectionPolicy {
  readonly id = "single-authorized-provider";
  select(input: ProviderSelectionPolicyInput): ProviderSelection {
    const stepId = input.step.id; const authorization = input.authorization.steps.find((item) => item.stepId === stepId);
    if (!authorization || authorization.status === "unresolved") return { stepId, status: "unresolved", reason: "No resolved provider candidate is available." };
    if (!authorization.authorizedProviderIds.length) return { stepId, status: "blocked", reason: "No provider is authorized." };
    if (authorization.authorizedProviderIds.length !== 1) return { stepId, status: "unresolved", reason: "Policy requires exactly one authorized provider." };
    return { stepId, providerId: authorization.authorizedProviderIds[0], status: "selected", reason: "The sole authorized provider was selected." };
  }
}

export class StableFirstAuthorizedProviderPolicy implements ProviderSelectionPolicy {
  readonly id = "stable-first-authorized-provider";
  select(input: ProviderSelectionPolicyInput): ProviderSelection {
    const stepId = input.step.id; const authorization = input.authorization.steps.find((item) => item.stepId === stepId);
    if (!authorization || authorization.status === "unresolved") return { stepId, status: "unresolved", reason: "No resolved provider candidate is available." };
    const providerId = [...authorization.authorizedProviderIds].sort()[0];
    return providerId ? { stepId, providerId, status: "selected", reason: "The lexically first authorized provider was selected." } : { stepId, status: "blocked", reason: "No provider is authorized." };
  }
}

export function selectPreparedPlanProviders(prepared: PreparedExecutionPlan, policy: ProviderSelectionPolicy): ProviderSelection[] {
  return prepared.plan.steps.map((step) => policy.select({ step, providerResolution: prepared.providerResolution, authorization: prepared.authorization }));
}
