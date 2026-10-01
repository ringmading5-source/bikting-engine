import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextMemory } from '../src/server/textMemory.js';
import { summarizeUsage } from '../src/bikting/core/execution/runControls.js';

test('exact text memory survives worker recreation and isolates changed specifications', async () => {
  const entries = new Map();
  const knowledgeStore = { get: async key => entries.get(key), set: async (key, value) => entries.set(key, structuredClone(value)) };
  let calls = 0;
  const generate = async () => { calls++; return { type: 'text_result', text: 'Summary', modelUsage: { calls: 1 } }; };
  const spec = { model: 'test', body: 'material', language: 'en' };
  await createTextMemory({ knowledgeStore }).resolve(spec, generate);
  const hit = await createTextMemory({ knowledgeStore }).resolve(spec, generate);
  assert.equal(calls, 1);
  assert.equal(hit.modelUsage.calls, 0);
  assert.equal(hit.memory.factualVerification, false);
  hit.text = 'mutation';
  assert.equal((await createTextMemory({ knowledgeStore }).resolve(spec, generate)).text, 'Summary');
  for (const change of [{ model: 'other' }, { body: 'new material' }, { language: 'fr' }]) {
    await createTextMemory({ knowledgeStore }).resolve({ ...spec, ...change }, generate);
  }
  assert.equal(calls, 4);
  entries.clear(); // Expired or invalidated storage must miss.
  await createTextMemory({ knowledgeStore }).resolve(spec, generate);
  assert.equal(calls, 5);
});

test('concurrent matching work shares a call and failed work is retried', async () => {
  const memory = createTextMemory({});
  let release;
  let calls = 0;
  const generate = async () => { calls++; await new Promise(resolve => { release = resolve; }); return { type: 'text_result', text: 'ok', modelUsage: { calls: 1 } }; };
  const first = memory.resolve({ body: 'same' }, generate);
  const second = memory.resolve({ body: 'same' }, generate);
  await new Promise(resolve => setImmediate(resolve));
  release();
  const results = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(results.reduce((sum, result) => sum + result.modelUsage.calls, 0), 1);
  await assert.rejects(memory.resolve({}, async () => { throw Error('failed'); }));
  assert.equal((await memory.resolve({}, async () => ({ type: 'text_result', text: 'retry' }))).text, 'retry');
});

test('a cached interpretation does not hide a newly paid worker call', () => {
  const usage = summarizeUsage({ context: { modelUsage: { calls: 2, inputTokens: 100 } } },
    [{ modelUsage: { calls: 1, inputTokens: 20, outputTokens: 5, estimatedCostUsd: 0.01 } }], { modelCacheHit: true });
  assert.equal(usage.modelCalls, 1);
  assert.equal(usage.inputTokens, 20);
  assert.equal(usage.estimatedCostUsd, 0.01);
});

test('bounded worker persists only usable output and records actual provider calls', async () => {
  const { createGeminiTextTool } = await import('../src/server/geminiTextTool.js');
  const entries = new Map();
  const knowledgeStore = { get: async key => entries.get(key), set: async (key, value) => entries.set(key, value) };
  let calls = 0;
  let tracked = 0;
  const options = { apiKey: 'test', model: 'test', knowledgeStore, onModelCall: () => { tracked++; return 0.01; },
    fetchImpl: async () => { calls++; return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: calls === 1 ? '' : 'Usable summary' }] } }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4 } }) }; } };
  const input = { semantic: { context: { task: { action: 'summarize', input: 'Supplied material' } } } };
  await assert.rejects(createGeminiTextTool(options).execute(input), /no text/);
  assert.equal(entries.size, 0);
  const generated = await createGeminiTextTool(options).execute(input);
  assert.equal(generated.modelUsage.calls, 1);
  const reused = await createGeminiTextTool(options).execute(input);
  assert.equal(reused.modelUsage.calls, 0);
  assert.equal(calls, 2);
  assert.equal(tracked, 2);
});
