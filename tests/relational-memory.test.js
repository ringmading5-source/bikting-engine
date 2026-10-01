import test from 'node:test';
import assert from 'node:assert/strict';
import { createRelationalMemory, featureVector } from '../src/server/relationalMemory.js';

function fixture() {
  const entries = new Map();
  let clock = 1000;
  const knowledgeStore = { get: async key => structuredClone(entries.get(key)), set: async (key, value) => entries.set(key, structuredClone(value)) };
  return { memory: createRelationalMemory({ knowledgeStore, now: () => clock }), knowledgeStore, advance: () => { clock = 5000; } };
}
const fact = (id, overrides = {}) => ({ id, kind: 'fact', subject: 'refund', predicate: 'window', value: '30 days', text: 'Refund window is 30 days',
  source: 'policy:v1', review: 'approved', context: { tenant: 'A' }, queries: ['What is the refund window?'], expiresAt: 4000, ...overrides });
const procedure = (id, preconditions, effects) => ({ id, kind: 'procedure', text: id, source: 'runbook:v1', review: 'approved', context: {}, queries: [], expiresAt: 4000, preconditions, effects });

test('retrieval ranks deterministic vectors but resolves only exact applicable approved facts', async () => {
  const { memory, advance } = fixture();
  await memory.put(fact('policy'));
  assert.deepEqual(featureVector('refund window'), featureVector('refund window'));
  const candidates = await memory.retrieve({ query: 'refund window', context: { tenant: 'A' } });
  assert.equal(candidates[0].record.id, 'policy');
  assert.equal(candidates[0].match, 'candidate');
  assert.equal((await memory.answer({ query: 'refund window', context: { tenant: 'A' } })).status, 'needs_knowledge');
  assert.equal((await memory.answer({ query: 'What is the refund window?', context: { tenant: 'B' } })).status, 'needs_knowledge');
  const answer = await memory.answer({ query: 'WHAT IS THE REFUND WINDOW?', context: { tenant: 'A' } });
  assert.equal(answer.text, '30 days');
  assert.equal(answer.modelCalls, 0);
  assert.equal(answer.verification, 'operator_approved');
  advance();
  assert.equal((await memory.answer({ query: 'What is the refund window?', context: { tenant: 'A' } })).status, 'needs_knowledge');
});

test('all exact competing records are checked, including beyond retrieval limit', async () => {
  const { memory } = fixture();
  await Promise.all(Array.from({ length: 21 }, (_, index) => memory.put(fact(`p${index}`))));
  await memory.put(fact('conflict', { value: '60 days' }));
  assert.equal((await memory.answer({ query: 'What is the refund window?', context: { tenant: 'A' } })).status, 'conflict');
  await memory.put(fact('conflict', { value: '60 days', review: 'candidate' }));
  assert.equal((await memory.answer({ query: 'What is the refund window?', context: { tenant: 'A' } })).status, 'resolved');
});

test('backward relevance and bounded forward search compose procedures with applicability checks', async () => {
  const { memory } = fixture();
  await memory.put(procedure('connect', { connected: false, permitted: true }, { connected: true }));
  await memory.put(procedure('read', { connected: true }, { read: true }));
  await memory.put(procedure('finish', { read: true }, { done: true }));
  await memory.put(procedure('irrelevant', {}, { noise: true }));
  const state = { connected: false, permitted: true };
  const result = await memory.plan({ state, goals: { done: true } });
  assert.equal(result.status, 'planned');
  assert.equal(result.verification, 'predicted');
  assert.deepEqual(result.steps.map(step => step.id), ['connect', 'read', 'finish']);
  assert.equal(state.connected, false); // Planning never mutates observed state.
  assert.equal((await memory.plan({ state: { connected: false, permitted: false }, goals: { done: true } })).status, 'needs_knowledge');
  assert.equal((await memory.plan({ state, goals: { done: true }, maxDepth: 1 })).status, 'budget_exhausted');
  assert.equal((await memory.plan({ state, goals: { done: true }, maxNodes: 1 })).status, 'budget_exhausted');
  const changed = await memory.plan({ state: { connected: true, read: true }, goals: { done: true } });
  assert.deepEqual(changed.steps.map(step => step.id), ['finish']);
});

test('records persist across engine instances and invalid input is rejected', async () => {
  const { memory, knowledgeStore } = fixture();
  await memory.put(fact('saved'));
  const restarted = createRelationalMemory({ knowledgeStore, now: () => 1000 });
  assert.equal((await restarted.answer({ query: 'What is the refund window?', context: { tenant: 'A' } })).status, 'resolved');
  assert.equal((await memory.remove({ id: 'saved' })).status, 'removed');
  assert.equal((await restarted.answer({ query: 'What is the refund window?', context: { tenant: 'A' } })).status, 'needs_knowledge');
  await assert.rejects(memory.put(fact('bad', { expiresAt: 1 })), /expired/);
  await assert.rejects(memory.put(procedure('bad', {}, {})), /effects/);
  await assert.rejects(memory.plan({ state: {}, goals: {}, maxNodes: 1000000 }), /Invalid/);
});
