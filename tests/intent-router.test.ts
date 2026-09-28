import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultIntentRules, IntentRuleRegistry } from '../src/runtime/intent-router';

test('one rule registry routes paraphrases to the same capability', () => {
  const rules = createDefaultIntentRules();
  assert.equal(rules.resolve('Calculate 125 * 48')?.capabilityId, 'math.calculate');
  assert.deepEqual(rules.resolve('Compute 125 * 48')?.inputs, { expression: '125 * 48' });
  assert.equal(rules.resolve('Build for me my personal website')?.capabilityId, 'code.scaffold');
  assert.equal(rules.resolve('Create my personal website')?.capabilityId, 'code.scaffold');
  assert.equal(rules.resolve('Teach me cells')?.capabilityId, 'knowledge.public_search');
  assert.deepEqual(rules.resolve('What is photosynthesis?')?.inputs, { topic: 'photosynthesis' });
  assert.equal(rules.resolve('Invent a new spaceship'), null);
});

test('new intent rules can be installed without changing browser routing', () => {
  const rules = new IntentRuleRegistry();
  rules.register({ id: 'sample', resolve: (text) => text === 'sample' ? { id: 'sample', intent: 'create', capabilityId: 'test.capability', inputs: {}, needsExplicitRun: true } : null });
  assert.equal(rules.resolve('sample')?.capabilityId, 'test.capability');
  assert.throws(() => rules.register({ id: 'sample', resolve: () => null }), /already registered/);
});
