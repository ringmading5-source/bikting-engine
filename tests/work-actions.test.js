import test from 'node:test';
import assert from 'node:assert/strict';
import { createBiktingRuntime } from '../src/runtime/BiktingRuntime.js';
import { createDefaultRegistries } from '../src/bikting/core/registry/createDefaultRegistries.js';
import { createGeminiTextTool } from '../src/server/geminiTextTool.js';
import { previewIntent } from '../src/server/intentPreview.js';
import { mockSemanticInterpreter } from '../src/bikting/core/adapters/mockSemanticInterpreter.js';

test('summarize and compare route to one bounded text worker with real output and usage', async () => {
  const defaults = createDefaultRegistries();
  const calls = [];
  defaults.tools.register(createGeminiTextTool({ apiKey: 'test-key', model: 'gemini-test', onModelCall: () => 0.001,
    fetchImpl: async (_url, options) => { calls.push(JSON.parse(options.body)); return { ok: true, async json() { return { candidates: [{ content: { parts: [{ text: 'A concise answer grounded in the input.' }] } }], usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 8 } }; } }; } }));
  const runtime = createBiktingRuntime({ tools: defaults.tools, models: defaults.models });
  for (const text of ['Summarize this: Cells have membranes and nuclei.', 'Compare cells and batteries using their functions']) {
    const result = await runtime.run({ text });
    assert.equal(result.status, 'completed');
    assert.match(result.workspace.moments.at(-1).display.text, /concise answer/);
    assert.equal(result.usage.modelCalls, 1);
    assert.equal(result.usage.estimatedCostUsd, 0.001);
  }
  assert.equal(calls.length, 2);
  assert.equal(calls[0].generationConfig.maxOutputTokens, 450);
});

test('other work verbs retain a capability gap, and missing inputs ask before model work', async () => {
  const preview = await previewIntent({ text: 'Summarize' }, mockSemanticInterpreter, false);
  assert.equal(preview.status, 'clarification');
  const result = await createBiktingRuntime().run({ text: 'Edit the website colors' });
  assert.equal(result.semantic.intent, 'edit');
  assert.equal(result.status, 'partial');
  assert.ok(result.outputs.unexecuted.some((item) => item.metadata?.capability === 'artifact.edit'));
});
