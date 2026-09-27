import { CapabilityRegistry } from '../capabilities/capability.registry';
import { CapabilityProviderRegistry } from '../providers/provider.registry';
import { resolvePlanProviders } from '../providers/provider.resolver';
import { evaluatePlanAuthorization } from '../core/authorization';
import { prepareExecutionPlan, withProviderSelections } from '../planning/prepared-plan';
import { SingleAuthorizedProviderPolicy, selectPreparedPlanProviders } from '../providers/provider-selection.policy';
import { CanonicalExecutionKernel } from '../execution/canonical-execution-kernel';
import { CanonicalProviderInvoker } from '../execution/provider-invoker';
import type { ExecutionPlan } from '../planning/plan.types';
// @ts-expect-error Existing JavaScript calculator has no declaration file.
import { calculatorTool } from '../bikting/core/tools/deterministic/mathTools.js';

/** A single local, side-effect-free capability wired through the canonical execution guard. */
export async function runLocalCalculation(expression: unknown) {
  if (typeof expression !== 'string' || !expression.trim() || expression.length > 200) throw new TypeError('Enter an arithmetic expression up to 200 characters.');
  // This endpoint accepts numeric arithmetic only, never variables, code, or an arbitrary plan.
  if (!/^[\d\s.+\-*/%^()×÷eE]+$/.test(expression)) throw new TypeError('Only numeric arithmetic is supported.');
  const capabilities = new CapabilityRegistry();
  capabilities.registerCapability({ id: 'math.calculate', kind: 'capability', name: 'Local arithmetic', operations: ['calculate'], inputs: [{ name: 'expression', type: 'string', required: true }], outputs: [{ name: 'numericResult', type: 'number' }] });
  const providers = new CapabilityProviderRegistry();
  providers.register({ id: 'math.calculator', name: 'Local safe calculator', capabilityIds: ['math.calculate'], executorKind: 'deterministic', availability: 'available' });
  const invoker = new CanonicalProviderInvoker();
  invoker.register({ providerId: 'math.calculator', capabilityIds: ['math.calculate'], async invoke({ input }) { return calculatorTool.execute(input); } });
  const plan: ExecutionPlan = {
    id: `local-calculation-${expression.trim()}`, goal: 'Calculate arithmetic', status: 'ready', requiredCapabilityIds: ['math.calculate'],
    steps: [{ id: 'calculate', action: 'math.calculate', capabilityId: 'math.calculate', status: 'pending',
      inputBindings: [{ target: 'expression', source: { type: 'literal', value: expression.trim() } }],
      expectedInputs: [{ name: 'expression', type: 'string', required: true }],
      expectedOutputs: [{ name: 'numericResult', type: 'number' }],
      provenance: [{ sourceType: 'engine', contextId: 'browser-local-calculation', category: 'explicit_user_action' }],
      verificationRequirements: [{ id: 'check-expression', method: 'expression_satisfaction', required: true, capabilityId: 'math.calculate' }],
    }],
  };
  const resolution = resolvePlanProviders(plan, capabilities, providers);
  const authorization = evaluatePlanAuthorization(resolution, []);
  let prepared = prepareExecutionPlan(plan, resolution, authorization);
  prepared = withProviderSelections(prepared, selectPreparedPlanProviders(prepared, new SingleAuthorizedProviderPolicy()));
  const result = await new CanonicalExecutionKernel(capabilities, providers, invoker).execute({ preparedPlan: prepared, projectId: 'browser-local-calculation' });
  if (result.status !== 'completed') throw new Error(result.failures.map(({ message }) => message).join('; ') || 'Calculation was not verified.');
  return { expression: expression.trim(), value: (result.outputs.calculate as { numericResult: number }).numericResult,
    providerId: 'math.calculator', verified: result.verificationResults.every(({ status }) => status === 'PASS'),
    planId: result.planId };
}
