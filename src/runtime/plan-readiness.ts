import type { ExecutionPlan } from '../planning/plan.types';
import { CapabilityRegistry } from '../capabilities/capability.registry';
import { CapabilityProviderRegistry } from '../providers/provider.registry';
import { resolvePlanProviders } from '../providers/provider.resolver';
import type { AuthorizationRequirement } from '../core/access';

export interface PreviewStepReadiness {
  stepId: string;
  capabilityId: string;
  providerCandidates: { id: string; availability: string; kind: string; simulated: boolean }[];
  accountSteps: string[];
  permissions: string[];
  state: 'unavailable' | 'account_required' | 'approval_required' | 'simulated' | 'ready_for_review';
  reason: string;
}

/** Read-only inspection. This never selects or invokes a provider. */
export function inspectPlanReadiness(plan: ExecutionPlan | null, capabilities: CapabilityRegistry, providers: CapabilityProviderRegistry): PreviewStepReadiness[] {
  if (!plan) return [];
  const resolution = resolvePlanProviders(plan, capabilities, providers);
  return resolution.steps.map((step) => {
    const capability = step.capabilityId ? capabilities.get(step.capabilityId) : undefined;
    const candidates = step.candidateProviderIds.map((id) => providers.get(id)!).filter(Boolean);
    const usable = candidates.filter(({ availability }) => availability === 'available');
    const requirements = usable.flatMap(({ authorizationRequirements }) => authorizationRequirements ?? []);
    const accountSteps = [...new Set([
      ...(capability?.access && capability.access.requirement !== 'free' ? [capability.access.requirement] : []),
      ...requirements.filter(({ authorizationType }) => authorizationType !== 'none').map(({ authorizationType }) => authorizationType),
    ])];
    const permissions = [...new Set(requirements.flatMap((item: AuthorizationRequirement) => item.permissions ?? []))];
    const simulated = usable.every((provider) => provider.metadata?.adapter === 'mock' || provider.metadata?.legacy === true);
    let state: PreviewStepReadiness['state'] = 'ready_for_review';
    let reason = 'Provider exists; execution still requires a separate authorized workflow.';
    if (!usable.length) { state = 'unavailable'; reason = 'No available execution provider is connected.'; }
    else if (accountSteps.length) { state = 'account_required'; reason = 'Provider access must be configured before execution.'; }
    else if (requirements.some(({ userApprovalRequired }) => userApprovalRequired) || capability?.access?.requirement === 'user_approval') { state = 'approval_required'; reason = 'Explicit user approval is required before execution.'; }
    else if (simulated) { state = 'simulated'; reason = 'Only a mock or unverified legacy adapter is registered.'; }
    return {
      stepId: step.stepId, capabilityId: step.capabilityId ?? '',
      providerCandidates: candidates.map(({ id, availability, executorKind, metadata }) => ({ id, availability, kind: executorKind, simulated: metadata?.adapter === 'mock' || metadata?.legacy === true })),
      accountSteps, permissions, state, reason,
    };
  });
}
