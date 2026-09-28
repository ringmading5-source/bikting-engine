import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiInterpreter } from '../src/server/geminiInterpreter.js';
import { createBiktingRuntime } from '../src/runtime/BiktingRuntime.js';

test('Gemini interpretation becomes a validated semantic input to the engine', async () => {
  let calls = 0;
  const interpret = createGeminiInterpreter({ apiKey: 'test-key', fetchImpl: async (url, options) => {
    calls++;
    assert.match(url, /gemini-2\.5-flash:generateContent$/);
    assert.equal(options.headers['x-goog-api-key'], 'test-key');
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      intent: 'explain', domain: 'science', concepts: ['plant'],
      relationships: [{ from: 'plant', relation: 'causes', to: 'growth' }, { from: 'plant', relation: 'unregistered_tool', to: 'money' }],
      explanation: 'Plants grow by using resources.'
    }) }] } }] }) };
  } });
  const result = await createBiktingRuntime({ interpret }).run({ text: 'Explain plant growth', type: 'text' });
  assert.equal(calls, 1);
  assert.equal(result.semantic.intent, 'explain');
  assert.deepEqual(result.semantic.relationships.map((item) => item.relation), ['causes']);
  assert.ok(result.plan.requiredCapabilities.some((item) => item.requiredCapability === 'text.generate'));
});

test('explicit arithmetic stays deterministic and does not spend a Gemini call', async () => {
  const interpret = createGeminiInterpreter({ apiKey: 'test-key', fetchImpl: async () => { throw new Error('Unexpected Gemini call'); } });
  const result = await createBiktingRuntime({ interpret }).run({ text: 'Calculate 2 + 3', type: 'text' });
  assert.equal(result.outputs.numericData[0], 5);
});
