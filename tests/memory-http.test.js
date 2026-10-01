import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBiktingServer } from '../server.js';

test('authenticated memory reaches live execution without calling the attached LLM', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bikting-memory-http-'));
  let calls = 0;
  const token = '1234567890abcdef';
  const composed = createBiktingServer({ env: { GEMINI_API_KEY: 'test', BIKTING_TEST_TOKEN: token, KNOWLEDGE_STORE_PATH: join(directory, 'memory.json') },
    fetchImpl: async () => { calls++; throw Error('Unexpected provider request'); } });
  await new Promise(resolve => composed.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${composed.server.address().port}`;
  const post = (path, input, authorized = true) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(authorized ? { 'x-bikting-test-token': token } : {}) }, body: JSON.stringify(input) });
  const record = { id: 'refund-v1', kind: 'fact', subject: 'refund', predicate: 'window', value: '30 days', text: 'Refund window is 30 days', source: 'policy:v1', review: 'approved', context: { language: 'en' }, queries: ['What is our refund window?'], expiresAt: Date.now() + 60000 };
  try {
    assert.equal((await post('/api/memory/records', record, false)).status, 401);
    assert.equal((await post('/api/memory/records', record)).status, 200);
    assert.equal((await post('/api/memory/records', { kind: 'invalid' })).status, 400);
    const result = await (await post('/api/run', { text: record.queries[0], language: 'en' })).json();
    assert.equal(result.status, 'completed');
    assert.equal(result.usage.modelCalls, 0);
    assert.equal(result.outputs.explanation.text, '30 days');
    assert.ok(result.outputs.explanation.provenance.some(item => item.source === 'relational_memory'));
    assert.equal(calls, 0);
    const mismatch = await (await post('/api/memory/answer', { query: record.queries[0], context: { language: 'fr' } })).json();
    assert.equal(mismatch.status, 'needs_knowledge');
    await post('/api/memory/records', { ...record, id: 'refund-v2', value: '60 days' });
    const conflict = await (await post('/api/run', { text: record.queries[0], language: 'en' })).json();
    assert.match(conflict.outputs.explanation.text, /conflict/);
    assert.equal(calls, 0);
    const procedure = { id: 'prepare', kind: 'procedure', text: 'Prepare an artifact', source: 'runbook:v1', review: 'approved', context: {}, queries: [], preconditions: { approved: true }, effects: { ready: true }, expiresAt: Date.now() + 60000 };
    await post('/api/memory/records', procedure);
    const plan = await (await post('/api/memory/plan', { state: { approved: true }, goals: { ready: true } })).json();
    assert.equal(plan.status, 'planned');
    assert.equal(plan.verification, 'predicted');
    assert.equal(calls, 0);
  } finally {
    await new Promise(resolve => composed.server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
