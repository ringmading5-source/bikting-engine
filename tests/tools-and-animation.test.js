import test from 'node:test';
import assert from 'node:assert/strict';
import { createBiktingRuntime } from '../src/runtime/BiktingRuntime.js';
import { renderGraph } from '../src/workspace/renderGraph.js';
import { PlaybackController } from '../src/workspace/playback.js';
import { listVisualTools, selectVisualTool } from '../src/visualization/visualToolCatalog.js';

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

test('playback begins with a visual frame and keeps every relationship reachable', async () => {
  const result = await createBiktingRuntime().run({ text: 'Explain how an electric motor works', type: 'text' });
  assert.equal(result.workspace.steps[0].visualState, 0);
  assert.equal(result.workspace.steps.filter((step) => typeof step.visualState === 'number').length >= result.workspace.scene.states.length, true);
  const container = { classList: { remove() {} }, innerHTML: '' };
  renderGraph(container, result.workspace.scene, result.workspace.scene.states.length - 1);
  assert.match(container.innerHTML, /min-height:\d+px/);
  assert.match(container.innerHTML, /class="node active/);
});

test('invalid vector dimensions report an execution error', async () => {
  const result = await createBiktingRuntime().run({ text: 'Calculate dot product of [1,2] and [3,4,5]', type: 'text' });
  assert.ok(result.outputs.errors.length);
});

test('math graph frames show a moving coordinate and labeled axes', async () => {
  const result = await createBiktingRuntime().run({ text: 'Plot y = x^2', type: 'text' });
  const scene = result.workspace.scene;
  assert.equal(scene.type, 'graph');
  const container = { classList: { remove() {} }, innerHTML: '' };
  renderGraph(container, scene, 0);
  const first = container.innerHTML;
  renderGraph(container, scene, scene.states.length - 1);
  assert.notEqual(first, container.innerHTML);
  assert.match(container.innerHTML, /plot-focus/);
  assert.match(container.innerHTML, />x<\/text>/);
  assert.match(container.innerHTML, />y<\/text>/);
});

test('fallback explanation speech advances the matching visual state', () => {
  const oldWindow = globalThis.window;
  const oldVoice = globalThis.SpeechSynthesisUtterance;
  const oldSynthesis = globalThis.speechSynthesis;
  const spoken = []; const rendered = [];
  globalThis.window = { speechSynthesis: true };
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  globalThis.speechSynthesis = { speak(utterance) { spoken.push(utterance); }, cancel() {} };
  try {
    const controller = new PlaybackController({ result: { workspace: { scene: { states: [{ activeNodes: ['cell'] }, { activeNodes: ['nucleus'] }] }, steps: [{ text: 'A cell is a living unit.', visualState: 0 }, { text: 'Its nucleus holds genetic material.', visualState: 1 }] } }, onStep: (index, step, state) => rendered.push({ index, text: step.text, state }) });
    controller.play();
    assert.equal(spoken[0].text, rendered[0].text);
    spoken[0].onend();
    assert.equal(spoken[1].text, rendered[1].text);
    assert.deepEqual(rendered[1].state.activeNodes, ['nucleus']);
    controller.stop();
  } finally { globalThis.window = oldWindow; globalThis.SpeechSynthesisUtterance = oldVoice; globalThis.speechSynthesis = oldSynthesis; }
});

test('visual tool routing distinguishes usable renderers from needed integrations', () => {
  const chart = selectVisualTool({ domain: 'mathematics', artifact: 'graph' });
  const molecule = selectVisualTool({ domain: 'chemistry', artifact: 'molecular_structure' });
  assert.equal(chart.selected.id, 'plotly');
  assert.equal(chart.recommended.id, 'matplotlib');
  assert.equal(molecule.selected.id, 'bikting.relationship-diagram');
  assert.equal(molecule.recommended.id, 'molstar');
  assert.equal(listVisualTools().find((tool) => tool.id === 'molstar').status, 'integration_needed');
});

test('Plotly adapter receives the visible graph points for each frame', () => {
  const oldWindow = globalThis.window;
  const calls = [];
  globalThis.window = { Plotly: { react(...args) { calls.push(args); } } };
  try {
    const container = { classList: { remove() {} }, innerHTML: '' };
    const scene = { type: 'graph', toolSelection: { selected: { id: 'plotly' } }, axes: { x: { label: 'time' }, y: { label: 'distance' } }, states: [{ pointCount: 2 }, { pointCount: 3 }], series: [{ expression: 'distance', points: [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 4 }] }] };
    renderGraph(container, scene, 0);
    renderGraph(container, scene, 1);
    assert.deepEqual(calls.map(([, traces]) => traces[0].x.length), [2, 3]);
    assert.equal(calls[0][2].xaxis.title, 'time');
  } finally { globalThis.window = oldWindow; }
});

test('tool execution produces an honest visual input-tool-result sequence', async () => {
  const runtime = createBiktingRuntime();
  const arithmetic = await runtime.run({ text: 'Calculate 2 + 3', type: 'text' });
  const converted = await runtime.run({ text: 'Convert 5 km to m', type: 'text' });
  const planned = await runtime.run({ text: 'Write Python code for interest', type: 'text' });
  assert.equal(arithmetic.workspace.scene.toolSelection.selected.id, 'bikting.execution-flow');
  assert.deepEqual(arithmetic.workspace.scene.states.map((state) => state.title), ['Input', 'Selected tool', 'Observed result']);
  assert.match(arithmetic.workspace.scene.states[2].text, /completed: 5/);
  assert.equal(converted.status, 'completed');
  assert.match(converted.workspace.scene.states[2].text, /5000 m/);
  assert.ok(planned.workspace.scene.states.some((state) => state.title === 'Execution status' && /planned: Capability registered/.test(state.text)));
});

test('website builder escapes supplied titles in its downloadable HTML', async () => {
  const result = await createBiktingRuntime().run({ text: 'Build me a website for <script>alert(1)</script>', type: 'text' });
  assert.equal(result.workspace.scene.type, 'website');
  assert.doesNotMatch(result.workspace.scene.html, /<script>/);
  assert.match(result.workspace.scene.html, /&lt;script&gt;/);
  const container = { classList: { remove() {} }, innerHTML: '' };
  renderGraph(container, result.workspace.scene, 0);
  assert.match(container.innerHTML, /website-sketch/);
  renderGraph(container, result.workspace.scene, 1);
  assert.match(container.innerHTML, /sandbox=""/);
  assert.match(container.innerHTML, /Download website.html/);
});
