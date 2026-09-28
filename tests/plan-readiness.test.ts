import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectPlanReadiness } from '../src/runtime/plan-readiness';
import { CapabilityRegistry } from '../src/capabilities/capability.registry';
import { CapabilityProviderRegistry } from '../src/providers/provider.registry';
import type { ExecutionPlan } from '../src/planning/plan.types';

const plan: ExecutionPlan = { id: 'plan-1', goal: 'Create a site', status: 'ready', steps: [
  { id: 'step-1', action: 'code.execute', capabilityId: 'code.execute', status: 'pending' },
  { id: 'step-2', action: 'text.generate', capabilityId: 'text.generate', status: 'pending' },
] };

test('readiness exposes unavailable, mock, and access gated providers without executing', () => {
  const capabilities = new CapabilityRegistry();
  capabilities.registerCapability({ id: 'code.execute', kind: 'capability', name: 'Code', operations: ['create'], inputs: [], outputs: [] });
  capabilities.registerCapability({ id: 'text.generate', kind: 'capability', name: 'Text', operations: ['write'], inputs: [], outputs: [], access: { requirement: 'account', provider: 'model' } });
  const providers = new CapabilityProviderRegistry();
  providers.register({ id: 'code.placeholder', name: 'Placeholder', capabilityIds: ['code.execute'], executorKind: 'custom', availability: 'unavailable' });
  providers.register({ id: 'mock.text', name: 'Mock', capabilityIds: ['text.generate'], executorKind: 'llm', availability: 'available', metadata: { adapter: 'mock' }, authorizationRequirements: [{ id: 'auth-1', providerId: 'mock.text', authorizationType: 'api_key', userApprovalRequired: true, permissions: ['generate'] }] });
  const readiness = inspectPlanReadiness(plan, capabilities, providers);
  assert.equal(readiness[0].state, 'unavailable');
  assert.deepEqual(readiness[1].accountSteps, ['account', 'api_key']);
  assert.deepEqual(readiness[1].permissions, ['generate']);
  assert.equal(readiness[1].state, 'account_required');
  assert.equal(inspectPlanReadiness(null, capabilities, providers).length, 0);
});
