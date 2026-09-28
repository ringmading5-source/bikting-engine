import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBiktingServer } from '../server.js';

test('HTTP website request uses bounded worker, validates output, and reuses it without another call', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bikting-worker-'));
  const calls = [];
  const env = { PORT: '0', HOST: '127.0.0.1', GEMINI_API_KEY: 'test-key', BIKTING_TEST_TOKEN: '1234567890abcdef', GEMINI_MODEL: 'gemini-2.5-flash',
    GEMINI_INPUT_COST_PER_MILLION: '1', GEMINI_OUTPUT_COST_PER_MILLION: '2', KNOWLEDGE_STORE_PATH: join(directory, 'knowledge.json') };
  const composed = createBiktingServer({ env, fetchImpl: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, status: 200, async json() { return { candidates: [{ content: { parts: [{ text: JSON.stringify({ html: '<!doctype html><html><body><h1>Study site</h1></body></html>', buildPlan: ['Create static preview'] }) }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 30 } }; } };
  } });
  try {
    await new Promise(resolve => composed.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${composed.server.address().port}`;
    const post = async () => fetch(`${base}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bikting-test-token': env.BIKTING_TEST_TOKEN }, body: JSON.stringify({ text: 'Build my personal study website' }) });
    const first = await (await post()).json();
    assert.equal(first.status, 'completed'); assert.equal(first.usage.modelCalls, 1);
    assert.ok(first.usage.estimatedCostUsd > 0);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].body.generationConfig.maxOutputTokens <= 700);
    const stored = JSON.parse(await readFile(join(directory, 'knowledge.json'), 'utf8'));
    assert.ok(stored.some(({ value }) => value?.nodes?.some(node => node.status === 'COMPLETED' && node.resultReference?.startsWith('validated:'))));
    const second = await (await post()).json();
    assert.equal(second.status, 'completed'); assert.equal(second.usage.modelCalls, 0); assert.equal(second.usage.cacheHit, true);
    assert.equal(calls.length, 1);
    const usage = await (await fetch(`${base}/api/usage`, { headers: { 'x-bikting-test-token': env.BIKTING_TEST_TOKEN } })).json();
    assert.equal(usage.totalModelCalls, 1); assert.ok(usage.cacheHits >= 1);
  } finally {
    await new Promise(resolve => composed.server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('cost budget blocks a worker call without falling through to unbounded generation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bikting-budget-'));
  let calls = 0;
  const env = { PORT: '0', HOST: '127.0.0.1', GEMINI_API_KEY: 'test-key', BIKTING_TEST_TOKEN: '1234567890abcdef',
    GEMINI_INPUT_COST_PER_MILLION: '1000', GEMINI_OUTPUT_COST_PER_MILLION: '1000', BIKTING_WORKER_MAX_COST_USD: '0', KNOWLEDGE_STORE_PATH: join(directory, 'cache.json') };
  const composed = createBiktingServer({ env, fetchImpl: async () => { calls++; throw new Error('Unexpected model call'); } });
  try {
    await new Promise(resolve => composed.server.listen(0, '127.0.0.1', resolve));
    const response = await fetch(`http://127.0.0.1:${composed.server.address().port}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bikting-test-token': env.BIKTING_TEST_TOKEN }, body: JSON.stringify({ text: 'Build my private study website' }) });
    const result = await response.json();
    assert.equal(calls, 0); assert.equal(result.semantic.variables.generationStatus, 'starter_fallback');
    assert.equal(composed.costBridge.telemetry.summary().totalModelCalls, 0);
  } finally {
    await new Promise(resolve => composed.server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('invalid website output creates one targeted repair before reuse', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bikting-repair-'));
  const prompts = [];
  const env = { PORT: '0', HOST: '127.0.0.1', GEMINI_API_KEY: 'test-key', BIKTING_TEST_TOKEN: '1234567890abcdef',
    GEMINI_INPUT_COST_PER_MILLION: '1', GEMINI_OUTPUT_COST_PER_MILLION: '1', KNOWLEDGE_STORE_PATH: join(directory, 'cache.json') };
  const composed = createBiktingServer({ env, fetchImpl: async (url, options) => {
    prompts.push(JSON.parse(options.body));
    const html = prompts.length === 1 ? '<html><body><script>bad()</script></body></html>' : '<!doctype html><html><body><h1>Safe study site</h1></body></html>';
    return { ok: true, status: 200, async json() { return { candidates: [{ content: { parts: [{ text: JSON.stringify({ html, buildPlan: ['Create preview'] }) }] } }], usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 25 } }; } };
  } });
  try {
    await new Promise(resolve => composed.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${composed.server.address().port}`;
    const post = async () => (await fetch(`${base}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bikting-test-token': env.BIKTING_TEST_TOKEN }, body: JSON.stringify({ text: 'Build my study website' }) })).json();
    const first = await post();
    assert.equal(first.status, 'completed'); assert.equal(first.usage.modelCalls, 2);
    assert.equal(prompts.length, 2);
    const repair = JSON.parse(prompts[1].contents[0].parts[0].text);
    assert.match(repair.objective, /Repair the output/);
    assert.ok(repair.maxInputTokens <= 600);
    assert.ok(!JSON.stringify(repair).includes('header with site name'));
    const second = await post();
    assert.equal(second.usage.cacheHit, true); assert.equal(prompts.length, 2);
  } finally {
    await new Promise(resolve => composed.server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
