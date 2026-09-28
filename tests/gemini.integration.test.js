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
  assert.equal(result.workspace.scene.states[0].action, 'pulse');
  assert.ok(result.trace.some((item) => item.section === 'VISUAL PROMPT'));
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

test('identical requests reuse their full interpretation and visual behavior', async () => {
  let calls = 0;
  const interpret = createGeminiInterpreter({ apiKey: 'private-key', fetchImpl: async (url, options) => {
    calls++;
    const prompt = JSON.parse(options.body).contents[0].parts[0].text;
    const output = prompt.includes('"relationships"')
      ? { steps: [{ from: 'water', relation: 'flows_to', to: 'plant', action: 'flow', narration: 'Water flows to the plant.' }] }
      : { intent: 'explain', domain: 'biology', visualArtifact: 'diagram', concepts: ['water', 'plant'], relationships: [{ from: 'water', relation: 'flows_to', to: 'plant' }], explanation: 'Water reaches the plant.' };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] } }] }) };
  } });
  const first = await interpret({ text: 'Explain water and plants' });
  const second = await interpret({ text: 'Explain water and plants' });
  assert.equal(calls, 1);
  assert.equal(first.context.visualProgramStatus, 'relationship_engine');
  assert.deepEqual(second, first);
});

test('recognized relationship intent runs its visual behavior without Gemini', async () => {
  const interpret = createGeminiInterpreter({ apiKey: 'private-key', fetchImpl: async () => { throw new Error('Gemini should not be called'); } });
  const result = await createBiktingRuntime({ interpret }).run({ text: 'Explain how an electric motor works', type: 'text' });
  assert.equal(result.workspace.scene.states.length, result.semantic.relationships.length);
  assert.equal(result.workspace.scene.states[0].action, 'flow');
  assert.equal(result.semantic.context.visualProgramStatus, 'relationship_engine');
});

test('a website build request executes the builder without Gemini', async () => {
  const interpret = createGeminiInterpreter({ apiKey: 'private-key', fetchImpl: async () => { throw new Error('Gemini should not be called'); } });
  const result = await createBiktingRuntime({ interpret }).run({ text: 'Build me a website for a bakery', type: 'text' });
  assert.equal(result.semantic.intent, 'build_website');
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.plan.capabilities, ['website.build']);
  assert.equal(result.workspace.scene.type, 'website');
  assert.match(result.workspace.scene.html, /Welcome to a bakery/);
  assert.deepEqual(result.semantic.context.task, { action: 'build', target: 'website', capability: 'website.build' });
  assert.deepEqual(result.semantic.relationships.map(({ from, relation, to }) => [from, relation, to]), [['build', 'produces', 'website']]);
});

test('intent engine preserves unsupported action targets rather than explaining them', async () => {
  const interpret = createGeminiInterpreter({ apiKey: 'private-key', fetchImpl: async () => { throw new Error('Gemini should not be called'); } });
  for (const [request, capability] of [['Build me a mobile app', 'artifact.build'], ['Deploy my website', 'website.deploy']]) {
    const result = await createBiktingRuntime({ interpret }).run({ text: request, type: 'text' });
    assert.deepEqual(result.plan.capabilities, [capability]);
    assert.ok(result.outputs.unexecuted.some((item) => item.metadata?.capability === capability));
    assert.equal(result.outputs.explanation, null);
    assert.match(result.workspace.steps.at(-1).text, /No connected tool can execute/);
  }
});

test('concurrent identical requests share one Gemini interpretation', async () => {
  let calls = 0;
  const interpret = createGeminiInterpreter({ apiKey: 'private-key', fetchImpl: async () => {
    calls++;
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ intent: 'explain', domain: 'biology', concepts: ['cell'], relationships: [], explanation: 'Cells are living units.' }) }] } }] }) };
  } });
  const [first, second] = await Promise.all([interpret({ text: 'Explain cells' }), interpret({ text: 'Explain cells' })]);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
});
