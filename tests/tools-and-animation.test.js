import test from 'node:test';
import assert from 'node:assert/strict';
import { createBiktingRuntime } from '../src/runtime/BiktingRuntime.js';
import { renderGraph } from '../src/workspace/renderGraph.js';

test('vector operations use explicit inputs across subject domains', async () => {
  const runtime = createBiktingRuntime();
  const dot = await runtime.run({ text: 'Calculate dot product of [1,2] and [3,4]', type: 'text' });
  const magnitude = await runtime.run({ text: 'Calculate magnitude of [3,4]', type: 'text' });
  assert.equal(dot.outputs.numericData[0], 11);
  assert.equal(magnitude.outputs.numericData[0], 5);
  assert.equal(dot.execution.find((entry) => entry.metadata?.capability === 'vector.calculate')?.source?.type, 'tool');
});

test('relationship scenes have progressive states visible in the renderer', async () => {
  const result = await createBiktingRuntime().run({ text: 'Explain how an electric motor works', type: 'text' });
  const scene = result.workspace.scene;
  assert.equal(scene.type, 'diagram');
  assert.equal(scene.states.length, scene.relationships.length);
  const container = { classList: { remove() {} }, innerHTML: '' };
  renderGraph(container, scene, 0);
  const first = container.innerHTML;
  renderGraph(container, scene, 1);
  assert.notEqual(first, container.innerHTML);
  assert.match(container.innerHTML, /class="edge active"/);
});

test('invalid vector dimensions report an execution error', async () => {
  const result = await createBiktingRuntime().run({ text: 'Calculate dot product of [1,2] and [3,4,5]', type: 'text' });
  assert.ok(result.outputs.errors.length);
});
