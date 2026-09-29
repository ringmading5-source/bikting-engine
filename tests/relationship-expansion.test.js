import test from 'node:test';
import assert from 'node:assert/strict';
import { expandRelationshipChain } from '../src/bikting/core/intent/expandRelationshipChain.js';
import { createGeminiInterpreter } from '../src/server/geminiInterpreter.js';
import { createBiktingRuntime } from '../src/runtime/BiktingRuntime.js';
import { previewIntent } from '../src/server/intentPreview.js';

test('the word teach alone activates an action and asks for its missing topic without Gemini', async () => {
  const interpret = createGeminiInterpreter({ apiKey: 'test', fetchImpl: async () => { throw Error('Gemini should not choose the action'); } });
  const request = { text: 'Teach' };
  const preview = await previewIntent(request, interpret, true);
  const result = await createBiktingRuntime({ interpret }).run(request);
  assert.equal(preview.status, 'clarification');
  assert.match(preview.question, /what.*teach/i);
  assert.equal(result.semantic.intent, 'teach');
  assert.equal(result.plan.procedure.status, 'blocked');
  assert.equal(result.workspace.wordComposition.words[0].role, 'action');
});

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
  const interpret = createGeminiInterpreter({ apiKey: 'test', fetchImpl: async (url, options) => {
    if (!calls) assert.match(JSON.parse(options.body).systemInstruction.parts[0].text, /do not generate a lesson or an explanation/i);
    return { ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payloads[calls++]) }] } }] }) };
  } });
  const result = await createBiktingRuntime({ interpret }).run({ text: 'Teach me cells' });
  assert.equal(calls, 3);
  assert.equal(result.semantic.intent, 'teach');
  assert.deepEqual(result.semantic.relationships.map(({ to }) => to), ['nucleus', 'dna']);
  assert.equal(result.semantic.context.teachingExpansion.stopReason, 'no_coherent_new_relationship');
  assert.equal(result.workspace.steps.at(-2).title, 'nucleus → dna');
});
