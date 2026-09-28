import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityResolutionLoop } from '../src/runtime/capability-resolution-loop';
import { CapabilityRegistry } from '../src/capabilities/capability.registry';
import { CapabilityProviderRegistry } from '../src/providers/provider.registry';
import { CanonicalProviderInvoker } from '../src/execution/provider-invoker';
import type { ExecutionPlan } from '../src/planning/plan.types';

const plan: ExecutionPlan = { id: 'plan-echo', goal: 'Echo a message', status: 'draft', requiredCapabilityIds: ['test.echo'], unresolvedCapabilityIds: ['test.echo'], steps: [{
  id: 'step-echo', action: 'test.echo', capabilityId: 'test.echo', status: 'pending', expectedInputs: [{ name: 'message', type: 'string', required: true }],
  inputBindings: [{ target: 'message', source: { type: 'literal', value: 'hello' } }], expectedOutputs: [{ name: 'echo', type: 'text' }], verificationRequirements: [], provenance: [{ sourceType: 'engine', contextId: 'test-plan' }],
}] };

test('missing tool is discovered, connected, authorized, then becomes ready without auto execution', () => {
  const capabilities = new CapabilityRegistry(), providers = new CapabilityProviderRegistry(), invoker = new CanonicalProviderInvoker();
  const loop = new CapabilityResolutionLoop(plan);
  const offers = [{ capabilityId: 'test.echo', providerId: 'example.echo', accessRequirement: 'account' }];
  let calls = 0;
  const first = loop.check({ capabilities, providers, invoker, offers });
  assert.equal(first.actions[0].type, 'install_capability');
  assert.equal(first.actions[0].candidateOffers?.[0].providerId, 'example.echo');
  capabilities.registerCapability({ id: 'test.echo', kind: 'capability', name: 'Echo', operations: ['echo'], inputs: [{ name: 'message', type: 'string', required: true }], outputs: [{ name: 'echo', type: 'text' }] });
  assert.equal(loop.check({ capabilities, providers, invoker, offers }).actions[0].type, 'connect_provider');
  providers.register({ id: 'example.echo', name: 'Echo provider', capabilityIds: ['test.echo'], executorKind: 'custom', availability: 'available', authorizationRequirements: [{ id: 'echo-access', providerId: 'example.echo', authorizationType: 'account', userApprovalRequired: true }] });
  invoker.register({ providerId: 'example.echo', capabilityIds: ['test.echo'], async invoke() { calls++; return { echo: 'hello' }; } });
  assert.equal(loop.check({ capabilities, providers, invoker }).actions[0].type, 'grant_access');
  const ready = loop.check({ capabilities, providers, invoker, grants: [{ id: 'grant-echo', requirementId: 'echo-access', providerId: 'example.echo', status: 'granted', grantedAt: '2026-09-28T00:00:00.000Z' }] });
  assert.equal(ready.status, 'ready_for_run');
  assert.equal(ready.preparedPlan?.status, 'ready');
  assert.equal(ready.preparedPlan?.providerSelections?.[0].providerId, 'example.echo');
  assert.equal(calls, 0, 'resolving a plan must not invoke a tool');
  assert.equal(plan.status, 'draft', 'the original plan must not be mutated');
});

test('loop stops after a bound and reports missing knowledge and inputs', () => {
  const capabilities = new CapabilityRegistry(), providers = new CapabilityProviderRegistry(), invoker = new CanonicalProviderInvoker();
  const needsInput: ExecutionPlan = { ...plan, unresolvedKnowledgeRequirementIds: ['biology.cell'], steps: [{ ...plan.steps[0], inputBindings: [] }] };
  const loop = new CapabilityResolutionLoop(needsInput, 2);
  const first = loop.check({ capabilities, providers, invoker });
  assert.equal(first.actions.some(({ type }) => type === 'resolve_knowledge'), true);
  assert.equal(loop.check({ capabilities, providers, invoker }).status, 'stalled');
  assert.equal(loop.check({ capabilities, providers, invoker }).checks, 2);
});

test('available provider still waits for required input and executable adapter', () => {
  const capabilities = new CapabilityRegistry(), providers = new CapabilityProviderRegistry(), invoker = new CanonicalProviderInvoker();
  capabilities.registerCapability({ id: 'test.echo', kind: 'capability', name: 'Echo', operations: ['echo'], inputs: [{ name: 'message', type: 'string', required: true }], outputs: [{ name: 'echo', type: 'text' }] });
  providers.register({ id: 'example.echo', name: 'Echo provider', capabilityIds: ['test.echo'], executorKind: 'custom', availability: 'available', authorizationRequirements: [] });
  const needsInput: ExecutionPlan = { ...plan, steps: [{ ...plan.steps[0], inputBindings: [] }] };
  const loop = new CapabilityResolutionLoop(needsInput);
  const first = loop.check({ capabilities, providers, invoker });
  assert.deepEqual(first.actions.map(({ type }) => type), ['enable_adapter', 'supply_input']);
  invoker.register({ providerId: 'example.echo', capabilityIds: ['test.echo'], async invoke() { return { echo: 'hello' }; } });
  const second = loop.check({ capabilities, providers, invoker, inputs: { message: 'hello' } });
  assert.equal(second.status, 'ready_for_run');
});
