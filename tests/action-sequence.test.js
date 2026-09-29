import test from 'node:test';
import assert from 'node:assert/strict';
import { parseActionSequence } from '../src/bikting/core/intent/parseActionSequence.js';
import { createBiktingRuntime } from '../src/runtime/BiktingRuntime.js';

test('a mentioned purpose is not a separate action, and negation blocks all work', async () => {
  assert.equal(parseActionSequence('Build a website for teaching cells').actions.length, 1);
  assert.equal(parseActionSequence("Don't publish my website").status, 'negated');
  assert.equal(parseActionSequence('Build a website, then publish it').status, 'unresolved');
  let called = 0;
  const runtime = createBiktingRuntime({ interpret: async () => { called++; throw new Error('Should not interpret'); } });
  const result = await runtime.run({ text: "Don't publish my website, then teach cells" });
  assert.equal(result.status, 'error');
  assert.equal(called, 0);
});

test('supported commands run in then order and retain distinct visual moments', async () => {
  const seen = [];
  const runtime = createBiktingRuntime({ interpret: async ({ text }) => {
    seen.push(text);
    const intent = text.startsWith('Teach') ? 'teach' : 'explore';
    return { intent, concepts: ['cell'], entities: [{ id: 'cell', label: 'Cell' }, { id: 'nucleus', label: 'Nucleus' }],
      relationships: [{ from: 'cell', relation: 'contains', to: 'nucleus' }], requestedOutputs: ['visual'], context: { domain: 'biology' }, confidence: 0.9 };
  } });
  const result = await runtime.run({ text: 'Teach cells, then explore nucleus' });
  assert.deepEqual(seen, ['Teach cells', 'explore nucleus']);
  assert.equal(result.status, 'completed');
  assert.equal(result.sequence.length, 2);
  assert.ok(result.workspace.moments.some((moment) => moment.title.startsWith('teach:')));
  assert.ok(result.workspace.moments.some((moment) => moment.title.startsWith('explore:')));
  assert.notEqual(result.workspace.moments[0].visual.scene, result.workspace.moments.at(-1).visual.scene);
});

test('an unfinished first action prevents later actions from running', async () => {
  const result = await createBiktingRuntime().run({ text: 'Teach cells, then explore the nucleus' });
  assert.equal(result.status, 'partial');
  assert.equal(result.sequence[1].status, 'not_run');
  assert.equal(result.workspace.moments.at(-1).title, 'Work paused');
});
