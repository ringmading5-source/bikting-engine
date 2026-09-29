import test from 'node:test';
import assert from 'node:assert/strict';
import { expandRelationshipChain } from '../src/bikting/core/intent/expandRelationshipChain.js';
import { createGeminiInterpreter } from '../src/server/geminiInterpreter.js';
import { createBiktingRuntime } from '../src/runtime/BiktingRuntime.js';

test('each new relationship becomes the next frontier; disconnected proposals end the chain', async () => {
  const rounds = [];
  const result = await expandRelationshipChain({ concept: 'cell', relationships: [{ from: 'cell', relation: 'contains', to: 'nucleus' }],
    propose: async ({ frontier }) => { rounds.push(frontier); return rounds.length === 1
      ? [{ from: 'nucleus', relation: 'contains', to: 'dna' }, { from: 'planet', relation: 'causes', to: 'rain' }]
      : [{ from: 'unrelated', relation: 'contains', to: 'noise' }]; } });
  assert.deepEqual(rounds, [['nucleus'], ['dna']]);
  assert.deepEqual(result.relationships.map(({ to }) => to), ['nucleus', 'dna']);
  assert.equal(result.stopReason, 'no_coherent_new_relationship');
});

test('live teaching interpretation expands connected knowledge and shows the stopping reason', async () => {
  let calls = 0;
  const payloads = [
    { intent: 'explain', domain: 'biology', concepts: ['cell'], relationships: [{ from: 'cell', relation: 'contains', to: 'nucleus' }], explanation: 'A cell contains a nucleus.' },
    { relationships: [{ from: 'nucleus', relation: 'contains', to: 'dna' }] },
    { relationships: [{ from: 'sun', relation: 'causes', to: 'heat' }] },
  ];
  const interpret = createGeminiInterpreter({ apiKey: 'test', fetchImpl: async () => ({ ok: true, status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payloads[calls++]) }] } }] }) }) });
  const result = await createBiktingRuntime({ interpret }).run({ text: 'Teach me cells' });
  assert.equal(calls, 3);
  assert.equal(result.semantic.intent, 'teach');
  assert.deepEqual(result.semantic.relationships.map(({ to }) => to), ['nucleus', 'dna']);
  assert.equal(result.semantic.context.teachingExpansion.stopReason, 'no_coherent_new_relationship');
  assert.equal(result.workspace.steps.at(-2).title, 'nucleus → dna');
});
