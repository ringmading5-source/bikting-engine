import { ExecutionPlan, PlanProvenanceReference } from "../planning/plan.types";
import { CapabilityProviderRegistry } from "./provider.registry";
import { AuthorizationRequirement } from "../core/access";
import { ProviderAvailability } from "./provider.types";
import { CapabilityRegistry } from "../capabilities/capability.registry";

export interface ProviderCandidateResolution {
  providerId: string;
  availability: ProviderAvailability;
  authorizationRequirements: AuthorizationRequirement[];
}

export type StepProviderResolutionStatus = "resolved" | "unavailable" | "no_provider" | "not_required";
export interface StepProviderResolution {
  stepId: string;
  capabilityId?: string;
  status: StepProviderResolutionStatus;
  candidateProviderIds: string[];
  availableProviderIds: string[];
  candidates: ProviderCandidateResolution[];
  unresolvedProvider: boolean;
  provenance: PlanProvenanceReference[];
}

export interface PlanProviderResolution {
  planId: string;
  steps: StepProviderResolution[];
  unresolvedStepIds: string[];
}

/** Resolves candidates only. It never chooses or invokes a provider. */
export function resolvePlanProviders(plan: ExecutionPlan, capabilities: CapabilityRegistry, registry: CapabilityProviderRegistry): PlanProviderResolution {
  const steps = plan.steps.map((step): StepProviderResolution => {
    if (!step.capabilityId) return { stepId: step.id, status: "not_required", candidateProviderIds: [], availableProviderIds: [], candidates: [], unresolvedProvider: false, provenance: [...(step.provenance ?? [])] };
    if (!capabilities.has(step.capabilityId)) return { stepId: step.id, capabilityId: step.capabilityId, status: "no_provider", candidateProviderIds: [], availableProviderIds: [], candidates: [], unresolvedProvider: true, provenance: [...(step.provenance ?? [])] };
    const providers = registry.findByCapability(step.capabilityId).sort((left, right) => left.id.localeCompare(right.id));
    const candidates = providers.map((provider) => ({ providerId: provider.id, availability: provider.availability, authorizationRequirements: structuredClone(provider.authorizationRequirements ?? []) }));
    const availableProviderIds = candidates.filter(({ availability }) => availability === "available").map(({ providerId }) => providerId);
    const status: StepProviderResolutionStatus = !candidates.length ? "no_provider" : availableProviderIds.length ? "resolved" : "unavailable";
    return { stepId: step.id, capabilityId: step.capabilityId, status, candidateProviderIds: candidates.map(({ providerId }) => providerId), availableProviderIds, candidates, unresolvedProvider: status !== "resolved", provenance: [...(step.provenance ?? [])] };
  });
  return deepFreeze({ planId: plan.id, steps, unresolvedStepIds: steps.filter(({ unresolvedProvider }) => unresolvedProvider).map(({ stepId }) => stepId) });
}

function deepFreeze<T>(value: T): T { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item); return Object.freeze(value); }
