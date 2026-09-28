import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBiktingServer } from '../server.js';

test('pilot measures deterministic, website, and explanation requests separately', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bikting-pilot-'));
  const token = '1234567890abcdef';
  const composed = createBiktingServer({ env: { PORT: '0', HOST: '127.0.0.1', GEMINI_API_KEY: 'test-key', BIKTING_TEST_TOKEN: token,
    GEMINI_INPUT_COST_PER_MILLION: '1', GEMINI_OUTPUT_COST_PER_MILLION: '2', KNOWLEDGE_STORE_PATH: join(directory, 'cache.json') },
  fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    const website = body.generationConfig?.responseSchema?.required?.includes('html');
    const output = website ? { html: '<!doctype html><html><body><h1>Study</h1></body></html>', buildPlan: ['Preview'] }
      : { intent: 'explain', domain: 'biology', concepts: ['mycelium', 'nutrients'], relationships: [{ from: 'mycelium', relation: 'flows_to', to: 'nutrients' }], explanation: 'Nutrients move through fungal networks.' };
    return { ok: true, status: 200, async json() { return { candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 25 } }; } };
  } });
  try {
    await new Promise(resolve => composed.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${composed.server.address().port}`;
    const post = async text => (await fetch(`${base}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bikting-test-token': token }, body: JSON.stringify({ text }) })).json();
    const calculation = await post('Calculate dot product of [1,2] and [3,4]');
    const website = await post('Build my personal study website');
    const explanation = await post('Explain mycelium nutrient networks');
    assert.equal(calculation.usage.modelCalls, 0);
    assert.equal(website.usage.modelCalls, 1);
    assert.equal(explanation.usage.modelCalls, 1);
    const feedback = await fetch(`${base}/api/pilot/feedback`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bikting-test-token': token }, body: JSON.stringify({ runId: explanation.pilotRunId, rating: 3, completed: false, friction: 'incomplete' }) });
    assert.equal(feedback.status, 200);
    assert.equal((await fetch(`${base}/api/pilot/summary`)).status, 401);
    const summary = await (await fetch(`${base}/api/pilot/summary`, { headers: { 'x-bikting-test-token': token } })).json();
    assert.equal(summary.totalRuns, 3);
    assert.equal(summary.byTask.deterministic.modelCalls, 0);
    assert.equal(summary.byTask.website.modelCalls, 1);
    assert.equal(summary.byTask.explanation.feedbackCount, 1);
    assert.equal(summary.byTask.explanation.friction.incomplete, 1);
    assert.equal(summary.byTask.explanation.userCompletionRate, 0);
    assert.equal(JSON.stringify(summary).includes('mycelium'), false);
  } finally {
    await new Promise(resolve => composed.server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
