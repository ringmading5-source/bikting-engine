import type { AuthorizationGrant } from '../core/access';
import { evaluatePlanAuthorization } from '../core/authorization';
import { CapabilityRegistry } from '../capabilities/capability.registry';
import type { ExecutionPlan } from '../planning/plan.types';
import { prepareExecutionPlan, withProviderSelections, type PreparedExecutionPlan } from '../planning/prepared-plan';
import { CapabilityProviderRegistry } from '../providers/provider.registry';
import { resolvePlanProviders } from '../providers/provider.resolver';
import { SingleAuthorizedProviderPolicy, selectPreparedPlanProviders } from '../providers/provider-selection.policy';
import { CanonicalProviderInvoker } from '../execution/provider-invoker';

export interface ResolutionAction {
  stepId?: string;
  capabilityId?: string;
  providerId?: string;
  type: 'install_capability' | 'connect_provider' | 'grant_access' | 'select_provider' | 'enable_adapter' | 'supply_input' | 'resolve_knowledge';
  message: string;
  suggestedCapabilityIds?: string[];
  candidateOffers?: { providerId: string; accessRequirement?: string }[];
}
export interface CapabilityOffer { capabilityId: string; providerId: string; accessRequirement?: string }
export interface ResolutionSnapshot {
  status: 'waiting' | 'ready_for_run' | 'stalled';
  checks: number;
  actions: ResolutionAction[];
  /** Present only after every dependency resolves. The caller must still request execution. */
  preparedPlan?: PreparedExecutionPlan;
}

/** Checks a fixed plan against changing registries and grants. Never installs, grants, or runs tools. */
export class CapabilityResolutionLoop {
  private checks = 0;
  constructor(private readonly plan: ExecutionPlan, private readonly maxChecks = 4) {
    if (!Number.isInteger(maxChecks) || maxChecks < 1) throw new TypeError('maxChecks must be positive.');
  }

  check(input: { capabilities: CapabilityRegistry; providers: CapabilityProviderRegistry; invoker: CanonicalProviderInvoker; offers?: readonly CapabilityOffer[]; grants?: readonly AuthorizationGrant[]; inputs?: Readonly<Record<string, unknown>> }): ResolutionSnapshot {
    if (this.checks >= this.maxChecks) return { status: 'stalled', checks: this.checks, actions: [] };
    this.checks++;
    const actions: ResolutionAction[] = [];
    const missing = this.plan.steps.filter(({ capabilityId }) => !capabilityId || !input.capabilities.has(capabilityId));
    for (const step of missing) {
      const candidateOffers = (input.offers ?? []).filter(({ capabilityId }) => capabilityId === step.capabilityId).map(({ providerId, accessRequirement }) => ({ providerId, accessRequirement }));
      actions.push({ type: 'install_capability', stepId: step.id, capabilityId: step.capabilityId, message: `Capability ${step.capabilityId ?? '(unspecified)'} is not installed.`, candidateOffers });
    }
    for (const requirementId of this.plan.unresolvedKnowledgeRequirementIds ?? []) actions.push({ type: 'resolve_knowledge', message: `Knowledge requirement ${requirementId} is unresolved.` });
    const providerResolution = resolvePlanProviders(this.plan, input.capabilities, input.providers);
    const authorization = evaluatePlanAuthorization(providerResolution, input.grants ?? []);
    for (const step of this.plan.steps) {
      if (missing.includes(step)) continue;
      const providerStep = providerResolution.steps.find(({ stepId }) => stepId === step.id)!;
      if (providerStep.status !== 'resolved') {
        const candidateOffers = (input.offers ?? []).filter(({ capabilityId }) => capabilityId === step.capabilityId).map(({ providerId, accessRequirement }) => ({ providerId, accessRequirement }));
        actions.push({ type: 'connect_provider', stepId: step.id, capabilityId: step.capabilityId, message: providerStep.candidateProviderIds.length ? 'Registered providers are unavailable.' : 'No provider implements this capability.', candidateOffers });
        continue;
      }
      const authStep = authorization.steps.find(({ stepId }) => stepId === step.id)!;
      if (!authStep.authorizedProviderIds.length) {
        for (const candidate of authStep.providers) actions.push({ type: 'grant_access', stepId: step.id, capabilityId: step.capabilityId, providerId: candidate.providerId, message: candidate.reasons.join(' ') });
        continue;
      }
      if (authStep.authorizedProviderIds.length !== 1) {
        actions.push({ type: 'select_provider', stepId: step.id, capabilityId: step.capabilityId, message: 'Choose one authorized provider before execution.' });
        continue;
      }
      const providerId = authStep.authorizedProviderIds[0];
      if (!input.invoker.has(providerId, step.capabilityId!)) actions.push({ type: 'enable_adapter', stepId: step.id, capabilityId: step.capabilityId, providerId, message: 'Provider has no executable Bikting adapter.' });
      for (const expected of step.expectedInputs ?? []) {
        if (expected.required && !step.inputBindings?.some(({ target }) => target === expected.name) && !Object.hasOwn(input.inputs ?? {}, expected.name)) actions.push({ type: 'supply_input', stepId: step.id, capabilityId: step.capabilityId, message: `Input ${expected.name} is required.` });
      }
    }
    if (actions.length) return { status: this.checks === this.maxChecks ? 'stalled' : 'waiting', checks: this.checks, actions };
    const plan = { ...this.plan, unresolvedCapabilityIds: [], status: 'ready' as const };
    let prepared = prepareExecutionPlan(plan, providerResolution, authorization);
    prepared = withProviderSelections(prepared, selectPreparedPlanProviders(prepared, new SingleAuthorizedProviderPolicy()));
    if (prepared.status !== 'ready') return { status: 'stalled', checks: this.checks, actions: [{ type: 'select_provider', message: 'No unique executable provider could be selected.' }] };
    return { status: 'ready_for_run', checks: this.checks, actions: [], preparedPlan: prepared };
  }
}
