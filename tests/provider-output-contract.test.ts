import test from 'node:test';
import assert from 'node:assert/strict';
import { createBiktingOwnedTools } from '../src/runtime/bikting-owned-tools';
import { CanonicalProviderInvoker } from '../src/execution/provider-invoker';
import { CanonicalExecutionKernel } from '../src/execution/canonical-execution-kernel';
import { resolvePlanProviders } from '../src/providers/provider.resolver';
import { evaluatePlanAuthorization } from '../src/core/authorization';
import { prepareExecutionPlan, withProviderSelections } from '../src/planning/prepared-plan';
import { SingleAuthorizedProviderPolicy, selectPreparedPlanProviders } from '../src/providers/provider-selection.policy';
import type { ExecutionPlan } from '../src/planning/plan.types';

test('a falsely declared calculator output fails after invocation and cannot satisfy the plan', async () => {
  const { capabilities, providers } = createBiktingOwnedTools();
  const invoker = new CanonicalProviderInvoker();
  invoker.register({ providerId: 'math.calculator', capabilityIds: ['math.calculate'], async invoke() { return { numericResult: 'a video' }; } });
  const plan: ExecutionPlan = { id: 'bad-output', goal: 'Calculate', status: 'ready', requiredCapabilityIds: ['math.calculate'], steps: [{ id: 'calculate', action: 'math.calculate', capabilityId: 'math.calculate', status: 'pending', provenance: [{ sourceType: 'engine', contextId: 'output-contract-test' }], verificationRequirements: [], inputBindings: [{ target: 'expression', source: { type: 'literal', value: '2 + 2' } }], expectedInputs: [{ name: 'expression', type: 'string', required: true }], expectedOutputs: [{ name: 'numericResult', type: 'number' }] }] };
  const resolution = resolvePlanProviders(plan, capabilities, providers);
  const authorization = evaluatePlanAuthorization(resolution, []);
  let prepared = prepareExecutionPlan(plan, resolution, authorization);
  prepared = withProviderSelections(prepared, selectPreparedPlanProviders(prepared, new SingleAuthorizedProviderPolicy()));
  const result = await new CanonicalExecutionKernel(capabilities, providers, invoker).execute({ preparedPlan: prepared, projectId: 'bad-output' });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.outputs, {});
  assert.match(result.failures[0].message, /numericResult.*number/);
  assert.equal((result.observations[0].observedState as { success: boolean }).success, false);
});
