import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskAgent } from '../src/server/taskAgent.js';

test('agent replans from observed outcomes and persists only verified execution', async () => {
  let observed = { ready: false, done: false };
  const states = [], saved = [];
  const memory = { async plan({ state }) { states.push(structuredClone(state)); return { status: 'planned', steps: [state.ready
    ? { id: 'finish', tool: 'finish', preconditions: { ready: true }, effects: { done: true } }
    : { id: 'prepare', tool: 'prepare', preconditions: { ready: false }, effects: { ready: true } }] }; } };
  const tools = new Map([['prepare', { execute: async () => { observed.ready = true; } }], ['finish', { execute: async () => { observed.done = true; } }]]);
  const result = await createTaskAgent({ memory, tools, observe: async () => structuredClone(observed), onVerified: async record => saved.push(record) }).run({ goals: { done: true } });
  assert.equal(result.status, 'completed');
  assert.equal(result.verification, 'observed');
  assert.equal(states[1].ready, true);
  assert.equal(saved.length, 2);
  assert.equal(result.modelCalls, 0);
});

test('provider success cannot promote predicted effects into observed state', async () => {
  const saved = [];
  const agent = createTaskAgent({ memory: { plan: async () => ({ status: 'planned', steps: [{ id: 'bad', tool: 'bad', preconditions: {}, effects: { done: true } }] }) },
    tools: new Map([['bad', { execute: async () => ({ status: 'success', done: true }) }]]), observe: async () => ({ done: false }), onVerified: async record => saved.push(record) });
  const result = await agent.run({ goals: { done: true } });
  assert.equal(result.status, 'failed_verification');
  assert.equal(result.state.done, false);
  assert.equal(saved.length, 0);
});

test('missing executor blocks and unresolved work escalates only to a proposal', async () => {
  const observe = async () => ({ done: false });
  const blocked = createTaskAgent({ observe, tools: new Map(), memory: { plan: async () => ({ status: 'planned', steps: [{ id: 'missing', tool: 'shell.anything' }] }) } });
  assert.equal((await blocked.run({ goals: { done: true } })).status, 'blocked');
  let escalations = 0;
  const unresolved = createTaskAgent({ observe, tools: new Map(), memory: { plan: async () => ({ status: 'needs_knowledge' }) }, escalate: async () => { escalations++; return { text: 'Proposed approach', modelCalls: 1 }; } });
  const result = await unresolved.run({ goals: { done: true } });
  assert.equal(result.status, 'needs_knowledge');
  assert.equal(result.modelCalls, 1);
  assert.equal(escalations, 1);
});

test('changed preconditions prevent execution and consume the bounded replan budget', async () => {
  let observations = 0, calls = 0;
  const agent = createTaskAgent({ observe: async () => ({ ready: observations++ > 0, done: false }),
    memory: { plan: async () => ({ status: 'planned', steps: [{ id: 'prepare', tool: 'prepare', preconditions: { ready: false }, effects: { done: true } }] }) },
    tools: new Map([['prepare', { execute: async () => { calls++; } }]]) });
  const result = await agent.run({ goals: { done: true }, maxSteps: 2 });
  assert.equal(result.status, 'budget_exhausted');
  assert.equal(calls, 0);
  assert.equal(result.trace.length, 2);
});
