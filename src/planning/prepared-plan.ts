import { PlanAuthorizationEvaluation } from "../core/authorization";
import { PlanProviderResolution } from "../providers/provider.resolver";
import { ExecutionPlan, PlanProvenanceReference, PlanVerificationRequirement } from "./plan.types";
import type { ProviderSelection } from "../providers/provider-selection.policy";

export type PreparedPlanStatus = "ready" | "partial" | "blocked" | "unresolved";
export interface PreparedExecutionPlan {
  id: string;
  plan: ExecutionPlan;
  providerResolution: PlanProviderResolution;
  authorization: PlanAuthorizationEvaluation;
  status: PreparedPlanStatus;
  unresolvedCapabilityIds: string[];
  unresolvedProviderStepIds: string[];
  blockedStepIds: string[];
  verificationRequirements: PlanVerificationRequirement[];
  provenance: PlanProvenanceReference[];
  providerSelections?: ProviderSelection[];
}

export function prepareExecutionPlan(plan: ExecutionPlan, providerResolution: PlanProviderResolution, authorization: PlanAuthorizationEvaluation): PreparedExecutionPlan {
  if (providerResolution.planId !== plan.id || authorization.planId !== plan.id) throw new Error("Prepared plan inputs must reference the same plan.");
  const unresolvedCapabilityIds = [...(plan.unresolvedCapabilityIds ?? [])];
  const unresolvedProviderStepIds = [...new Set([...providerResolution.unresolvedStepIds, ...authorization.unresolvedStepIds])].sort();
  const blockedStepIds = [...authorization.blockedStepIds].sort();
  const status: PreparedPlanStatus = blockedStepIds.length ? "blocked" : unresolvedCapabilityIds.length || unresolvedProviderStepIds.length ? (plan.steps.length > unresolvedProviderStepIds.length ? "partial" : "unresolved") : "ready";
  return deepFreeze({ id: `prepared-${plan.id}`, plan, providerResolution, authorization, status, unresolvedCapabilityIds, unresolvedProviderStepIds, blockedStepIds, verificationRequirements: [...(plan.canonicalVerificationRequirements ?? [])], provenance: [...(plan.provenance ?? [])] });
}

export function withProviderSelections(prepared: PreparedExecutionPlan, providerSelections: ProviderSelection[]): PreparedExecutionPlan {
  if (providerSelections.some(({ stepId }) => !prepared.plan.steps.some(({ id }) => id === stepId))) throw new Error("Provider selection references an unknown plan step.");
  const policyBlocked = providerSelections.filter(({ status }) => status === "blocked").map(({ stepId }) => stepId);
  const policyUnresolved = providerSelections.filter(({ status }) => status === "unresolved").map(({ stepId }) => stepId);
  const blockedStepIds = [...new Set([...prepared.blockedStepIds, ...policyBlocked])].sort();
  const unresolvedProviderStepIds = [...new Set([...prepared.unresolvedProviderStepIds, ...policyUnresolved])].sort();
  const status: PreparedPlanStatus = blockedStepIds.length ? "blocked" : unresolvedProviderStepIds.length || prepared.unresolvedCapabilityIds.length ? (prepared.plan.steps.length > unresolvedProviderStepIds.length ? "partial" : "unresolved") : "ready";
  return deepFreeze({ ...prepared, status, blockedStepIds, unresolvedProviderStepIds, providerSelections: structuredClone(providerSelections) });
}

function deepFreeze<T>(value: T): T { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item); return Object.freeze(value); }
