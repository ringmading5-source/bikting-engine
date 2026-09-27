import { AuthorizationGrant, AuthorizationRequirement } from "./access";
import { PlanProviderResolution } from "../providers/provider.resolver";

export type ProviderAuthorizationStatus = "authorized" | "authorization_required" | "denied" | "unavailable";
export interface ProviderAuthorizationEvaluation {
  providerId: string;
  status: ProviderAuthorizationStatus;
  requirementIds: string[];
  grantIds: string[];
  reasons: string[];
}
export interface StepAuthorizationEvaluation {
  stepId: string;
  status: "authorized" | "blocked" | "unresolved";
  providers: ProviderAuthorizationEvaluation[];
  authorizedProviderIds: string[];
}
export interface PlanAuthorizationEvaluation {
  planId: string;
  steps: StepAuthorizationEvaluation[];
  blockedStepIds: string[];
  unresolvedStepIds: string[];
}

/** Evaluates existing grants only. It never creates grants or accesses credentials. */
export function evaluatePlanAuthorization(resolution: PlanProviderResolution, grants: readonly AuthorizationGrant[]): PlanAuthorizationEvaluation {
  const steps = resolution.steps.map((step): StepAuthorizationEvaluation => {
    if (step.status !== "resolved") return { stepId: step.stepId, status: "unresolved", providers: step.candidates.map(({ providerId }) => ({ providerId, status: "unavailable", requirementIds: [], grantIds: [], reasons: ["Provider is not available."] })), authorizedProviderIds: [] };
    const providers = step.candidates.filter(({ availability }) => availability === "available").map((candidate) => evaluateProvider(candidate.providerId, candidate.authorizationRequirements, grants));
    const authorizedProviderIds = providers.filter(({ status }) => status === "authorized").map(({ providerId }) => providerId);
    return { stepId: step.stepId, status: authorizedProviderIds.length ? "authorized" : "blocked", providers, authorizedProviderIds };
  });
  return deepFreeze({ planId: resolution.planId, steps, blockedStepIds: steps.filter(({ status }) => status === "blocked").map(({ stepId }) => stepId), unresolvedStepIds: steps.filter(({ status }) => status === "unresolved").map(({ stepId }) => stepId) });
}

function evaluateProvider(providerId: string, requirements: AuthorizationRequirement[], grants: readonly AuthorizationGrant[]): ProviderAuthorizationEvaluation {
  if (!requirements.length) return { providerId, status: "authorized", requirementIds: [], grantIds: [], reasons: ["No authorization is required."] };
  const matched: AuthorizationGrant[] = []; const reasons: string[] = []; let denied = false;
  for (const requirement of requirements) {
    const providerGrants = grants.filter((grant) => grant.providerId === providerId && grant.requirementId === requirement.id);
    const valid = providerGrants.find((grant) => grant.status === "granted" && includesAll(grant.grantedScopes, requirement.scopes) && includesAll(grant.grantedPermissions, requirement.permissions));
    if (valid) matched.push(valid);
    else {
      denied ||= providerGrants.some((grant) => grant.status === "revoked" || grant.status === "expired");
      reasons.push(providerGrants.length ? `No active grant satisfies ${requirement.id}.` : `Authorization ${requirement.id} has not been granted.`);
    }
  }
  const status: ProviderAuthorizationStatus = matched.length === requirements.length ? "authorized" : denied ? "denied" : "authorization_required";
  return { providerId, status, requirementIds: requirements.map(({ id }) => id), grantIds: matched.map(({ id }) => id), reasons: reasons.length ? reasons : ["All authorization requirements are satisfied."] };
}
function includesAll(actual: string[] | undefined, required: string[] | undefined): boolean { return !(required?.length) || required.every((value) => actual?.includes(value)); }
function deepFreeze<T>(value: T): T { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item); return Object.freeze(value); }
