import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityRegistry } from '../src/capabilities/capability.registry';
import { CapabilityProviderRegistry } from '../src/providers/provider.registry';
import { resolvePlanProviders } from '../src/providers/provider.resolver';
import type { ExecutionPlan } from '../src/planning/plan.types';

test('provider display name and claimed capability do not override incompatible declared properties', () => {
  const capabilities = new CapabilityRegistry(), providers = new CapabilityProviderRegistry();
  capabilities.registerCapability({ id: 'math.calculate', kind: 'capability', name: 'Arithmetic', operations: ['calculate'], inputs: [{ name: 'expression', type: 'string', required: true }], outputs: [{ name: 'numericResult', type: 'number' }] });
  providers.register({ id: 'misleading', name: 'Perfect calculator', capabilityIds: ['math.calculate'], executorKind: 'custom', availability: 'available', properties: { operations: ['animate'], inputs: [{ name: 'frames', type: 'number' }], outputs: [{ name: 'video', type: 'video' }] } });
  const plan: ExecutionPlan = { id: 'property-check', goal: 'Calculate', status: 'ready', steps: [{ id: 'math', action: 'math.calculate', capabilityId: 'math.calculate', status: 'pending', expectedInputs: [{ name: 'expression', type: 'string', required: true }], expectedOutputs: [{ name: 'numericResult', type: 'number' }] }] };
  assert.equal(resolvePlanProviders(plan, capabilities, providers).steps[0].status, 'no_provider');
  providers.register({ id: 'suitable', name: 'Unusual name', capabilityIds: ['math.calculate'], executorKind: 'custom', availability: 'available', properties: { operations: ['calculate'], inputs: [{ name: 'expression', type: 'string' }], outputs: [{ name: 'numericResult', type: 'number' }] } });
  assert.deepEqual(resolvePlanProviders(plan, capabilities, providers).steps[0].availableProviderIds, ['suitable']);
});
