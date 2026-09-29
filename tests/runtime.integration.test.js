import test from 'node:test';
import assert from 'node:assert/strict';
import { createBiktingRuntime } from '../src/runtime/BiktingRuntime.js';

test('a browser-shaped request executes through the canonical runtime into deterministic tools and a workspace scene', async () => {
  const runtime = createBiktingRuntime();
  const result = await runtime.run({ type: 'text', text: 'Plot force as mass changes from 1 to 10 kg with acceleration 5 m/s².', receivedAt: '2026-01-01T00:00:00.000Z' });

  assert.equal(result.semantic.source, 'browser');
  assert.equal(result.semantic.modality, 'text');
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.plan.capabilities, ['data.generate_range', 'physics.calculate_force_series', 'math.calculate', 'visual.scene']);
  assert.ok(result.execution.some((item) => item.source?.id === 'physics.calculator' && item.status === 'completed'));
  assert.ok(result.execution.some((item) => item.source?.id === 'visualization.structured-scene' && item.status === 'completed'));
  assert.equal(result.workspace.scene, result.outputs.visual.structuredVisualScenes);
  assert.equal(result.workspace.scene.type, 'graph');
  assert.ok(result.workspace.steps.length > 0);
  assert.ok(result.trace.some((entry) => entry.section === 'EXECUTION'));
});

test('planned providers remain visible as unexecuted work instead of producing a completed result', async () => {
  const result = await createBiktingRuntime().run({ type: 'text', text: 'Write a Python function that calculates compound interest.' });

  assert.equal(result.status, 'partial');
  assert.ok(result.outputs.unexecuted.some((item) => item.metadata?.capability === 'code.execute' && item.status === 'planned'));
  assert.equal(result.workspace.status, 'partial');
  assert.ok(result.workspace.steps.some((step) => step.title === 'Unexecuted work'));
});

test('teach executes an ordered procedure derived from connected relationships', async () => {
  const runtime = createBiktingRuntime({ interpret: async () => ({ intent: 'teach', concepts: ['cell'],
    entities: [{ id: 'cell', label: 'Cell' }], relationships: [
      { from: 'cell', relation: 'contains', to: 'nucleus' },
      { from: 'nucleus', relation: 'contains', to: 'dna' },
      { from: 'unrelated', relation: 'contains', to: 'other' },
    ], requestedOutputs: ['explanation', 'visual'], context: { domain: 'biology' }, confidence: 0.8 }) });
  const result = await runtime.run({ text: 'Teach me cells' });
  assert.equal(result.semantic.intent, 'teach');
  assert.deepEqual(result.workspace.wordComposition.words.map(({ surface, role }) => [surface, role]), [['Teach', 'action'], ['me', 'recipient'], ['cells', 'target']]);
  assert.equal(result.plan.procedure.status, 'ready');
  assert.deepEqual(result.plan.procedure.stages.slice(1, 3).map(({ relationships }) => relationships[0].to), ['nucleus', 'dna']);
  assert.equal(result.execution[0].type, 'relationship_action_procedure');
  assert.equal(result.execution[0].status, 'completed');
  assert.equal(result.workspace.steps.at(-1).title, 'Check understanding');
});

test('teach without connected knowledge asks for context instead of inventing a lesson', async () => {
  const result = await createBiktingRuntime().run({ text: 'Teach me cells' });
  assert.equal(result.status, 'partial');
  assert.equal(result.plan.procedure.status, 'blocked');
  assert.match(result.workspace.steps[0].text, /need relationships/i);
});

test('a word modifier changes the action sequence without changing the topic relationships', async () => {
  const interpret = async () => ({ intent: 'teach', concepts: ['cell'], relationships: [
    { from: 'cell', relation: 'contains', to: 'nucleus' }, { from: 'nucleus', relation: 'contains', to: 'dna' },
    { from: 'dna', relation: 'produces', to: 'rna' },
  ], requestedOutputs: ['explanation'], context: { domain: 'biology' }, confidence: 0.8 });
  const runtime = createBiktingRuntime({ interpret });
  const full = await runtime.run({ text: 'Teach me cells' });
  const brief = await runtime.run({ text: 'Teach me cells briefly' });
  assert.equal(full.plan.procedure.stages.length, 5);
  assert.equal(brief.plan.procedure.stages.length, 4);
  assert.equal(brief.workspace.wordComposition.words.at(-1).role, 'modifier');
});
