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
