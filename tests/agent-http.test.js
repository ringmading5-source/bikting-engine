import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBiktingServer } from '../server.js';
import { fileHash } from '../src/server/codingAgent.js';

test('coding API performs verified work, persists evidence, and bounds attached model proposals', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'bstae-agent-http-'));
  const token = '1234567890abcdef';
  const original = 'export const value = 1;\n';
  const content = 'export const value = 2;\n';
  await writeFile(join(workspace, 'app.mjs'), original);
  let calls = 0;
  const env = { BIKTING_TEST_TOKEN: token, GEMINI_API_KEY: 'test', BIKTING_AGENT_WORKSPACE: workspace, KNOWLEDGE_STORE_PATH: join(workspace, 'memory.json') };
  const composed = createBiktingServer({ env, fetchImpl: async (_url, options) => {
    calls++;
    assert.equal(JSON.parse(options.body).generationConfig.maxOutputTokens, 2000);
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ content, explanation: 'Change the value.' }) }] } }], usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 12 } }) };
  } });
  await new Promise(resolve => composed.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${composed.server.address().port}`;
  const post = (path, input, authorized = true) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(authorized ? { 'x-bikting-test-token': token } : {}) }, body: JSON.stringify(input) });
  try {
    assert.equal((await post('/api/agent/code', {}, false)).status, 401);
    const proposal = await (await post('/api/agent/propose', { path: 'app.mjs', instruction: 'Set the value to two.' })).json();
    assert.equal(proposal.status, 'proposal');
    assert.equal(proposal.verification, 'unverified');
    assert.equal(proposal.modelUsage.calls, 1);
    assert.equal(await readFile(join(workspace, 'app.mjs'), 'utf8'), original);
    const result = await (await post('/api/agent/code', { path: proposal.path, content: proposal.content, expectedHash: proposal.expectedHash })).json();
    assert.equal(result.status, 'completed');
    assert.equal(result.modelCalls, 0);
    assert.equal(calls, 1);
    const stored = JSON.parse(await readFile(join(workspace, 'memory.json'), 'utf8'));
    assert.equal(stored.filter(item => item.value.verification === 'observed').length, 2);
    assert.equal((await post('/api/agent/code', { path: 'app.mjs', content, expectedHash: fileHash(original) })).status, 409);
    assert.equal((await post('/api/agent/code', { path: '../escape.js', content, expectedHash: fileHash(content) })).status, 409);
    assert.equal(composed.costBridge.telemetry.summary().totalModelCalls, 1);
  } finally {
    await new Promise(resolve => composed.server.close(resolve));
    await rm(workspace, { recursive: true, force: true });
  }
});
