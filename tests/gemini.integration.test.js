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

test('a missing model reports available IDs without exposing the API key', async () => {
  const interpret = createGeminiInterpreter({ apiKey: 'private-key', model: 'wrong-model', fetchImpl: async (url) => url.includes(':generateContent')
    ? { ok: false, status: 404 }
    : { ok: true, json: async () => ({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }) } });
  await assert.rejects(interpret({ text: 'Explain cells' }), (error) => {
    assert.match(error.message, /No available Gemini text model.*Tried: wrong-model/);
    assert.match(error.message, /gemini-2.5-flash/);
    assert.doesNotMatch(error.message, /private-key/);
    return true;
  });
});

test('an unavailable default model retries a listed Flash-Lite model', async () => {
  const requests = [];
  const interpret = createGeminiInterpreter({ apiKey: 'private-key', fetchImpl: async (url) => {
    requests.push(url);
    if (url.includes('gemini-2.5-flash:generateContent')) return { ok: false, status: 404 };
    if (url.includes('/models?pageSize=')) return { ok: true, json: async () => ({ models: [{ name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ intent: 'explain', domain: 'biology', concepts: ['cell'], relationships: [], explanation: 'Cells are living units.' }) }] } }] }) };
  } });
  const result = await interpret({ text: 'Explain cells' });
  assert.equal(requests.length, 3);
  assert.equal(result.provenance[0].detail, 'gemini-2.5-flash-lite');
});

test('tries advertised text models in order, stopping at the first success', async () => {
  const attempted = [];
  const interpret = createGeminiInterpreter({ apiKey: 'private-key', fetchImpl: async (url) => {
    if (url.includes('/models?')) return { ok: true, json: async () => ({ models: [
      { name: 'models/gemini-3-pro', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.1-flash-lite', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-image', supportedGenerationMethods: ['generateContent'] }
    ] }) };
    attempted.push(url.match(/models\/([^/:]+):generateContent/)[1]);
    return attempted.length < 3 ? { ok: false, status: 404 } : { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ intent: 'explain', domain: 'science', concepts: ['cell'], relationships: [], explanation: 'A cell is a living unit.' }) }] } }] }) };
  } });
  const result = await interpret({ text: 'Explain cells' });
  assert.deepEqual(attempted, ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.1-flash-lite']);
  assert.equal(result.provenance[0].detail, 'gemini-3.1-flash-lite');
});

test('quota errors stop model retries', async () => {
  let calls = 0;
  const interpret = createGeminiInterpreter({ apiKey: 'private-key', fetchImpl: async (url) => {
    calls++;
    if (url.includes('/models?')) return { ok: true, json: async () => ({ models: [{ name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] }) };
    return { ok: false, status: calls === 1 ? 404 : 429 };
  } });
  await assert.rejects(interpret({ text: 'Explain cells' }), /429/);
  assert.equal(calls, 3);
});
