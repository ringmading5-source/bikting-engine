import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileHash } from '../src/server/codingAgent.js';
import { runProjectAgent } from '../src/server/projectAgent.js';
import { createRelationalMemory } from '../src/server/relationalMemory.js';
import { createBiktingServer } from '../server.js';

async function setup() {
  const workspace = await mkdtemp(join(tmpdir(), 'bstae-project-'));
  const data = new Map();
  const memory = createRelationalMemory({ knowledgeStore: { get: async key => data.get(key), set: async (key, value) => data.set(key, value) } });
  for (const record of [
    { id: 'apply', tool: 'project.apply', preconditions: { filesMatch: false }, effects: { filesMatch: true } },
    { id: 'syntax', tool: 'project.syntax', preconditions: { filesMatch: true }, effects: { syntaxValid: true } },
    { id: 'tests', tool: 'project.tests', preconditions: { filesMatch: true, syntaxValid: true }, effects: { testsPassed: true } },
  ]) await memory.put({ ...record, kind: 'procedure', text: record.id, source: 'test:runbook', review: 'approved', context: { agent: 'coding-project-v1' }, queries: [], expiresAt: Date.now() + 60000 });
  const original = 'export const value = 1;\n';
  await writeFile(join(workspace, 'value.mjs'), original);
  await writeFile(join(workspace, 'verify.mjs'), "import assert from 'node:assert/strict'; import {value} from './value.mjs'; assert.equal(value, 2);\n");
  return { workspace, memory, original, cleanup: () => rm(workspace, { recursive: true, force: true }) };
}

test('multi-file agent creates a file, edits another, and observes registered tests passing', async () => {
  const f = await setup();
  try {
    const result = await runProjectAgent({ ...f, changes: [
      { path: 'value.mjs', content: 'export const value = 2;\n', expectedHash: fileHash(f.original) },
      { path: 'new.mjs', content: 'export const ready = true;\n', expectedHash: null },
    ], testFiles: ['verify.mjs'] });
    assert.equal(result.status, 'completed');
    assert.equal(result.verification, 'observed');
    assert.equal(result.state.testsPassed, true);
    assert.deepEqual(result.trace.map(step => step.tool), ['project.apply', 'project.syntax', 'project.tests']);
    assert.equal(result.modelCalls, 0);
    assert.equal(await readFile(join(f.workspace, 'new.mjs'), 'utf8'), 'export const ready = true;\n');
  } finally { await f.cleanup(); }
});

test('failed project tests restore edited files and remove newly created files', async () => {
  const f = await setup();
  try {
    const result = await runProjectAgent({ ...f, changes: [
      { path: 'value.mjs', content: 'export const value = 3;\n', expectedHash: fileHash(f.original) },
      { path: 'new.mjs', content: 'export const ready = true;\n', expectedHash: null },
    ], testFiles: ['verify.mjs'] });
    assert.equal(result.status, 'failed');
    assert.equal(result.rollback.status, 'restored');
    assert.equal(result.state.filesMatch, false);
    assert.equal(await readFile(join(f.workspace, 'value.mjs'), 'utf8'), f.original);
    await assert.rejects(readFile(join(f.workspace, 'new.mjs')), { code: 'ENOENT' });
  } finally { await f.cleanup(); }
});

test('invalid later candidate never changes an earlier valid file', async () => {
  const f = await setup();
  try {
    const result = await runProjectAgent({ ...f, changes: [
      { path: 'value.mjs', content: 'export const value = 2;', expectedHash: fileHash(f.original) },
      { path: 'new.mjs', content: 'const = ;', expectedHash: null },
    ] });
    assert.equal(result.status, 'failed');
    assert.equal(await readFile(join(f.workspace, 'value.mjs'), 'utf8'), f.original);
  } finally { await f.cleanup(); }
});

test('a concurrent edit is preserved and reported as a rollback conflict', async () => {
  const f = await setup();
  try {
    const result = await runProjectAgent({ ...f, changes: [{ path: 'value.mjs', content: 'export const value = 2;', expectedHash: fileHash(f.original) }], testFiles: ['verify.mjs'],
      onVerified: async record => { if (record.procedure === 'apply') await writeFile(join(f.workspace, 'value.mjs'), 'export const external = true;'); } });
    assert.equal(result.rollback.status, 'conflict');
    assert.equal(await readFile(join(f.workspace, 'value.mjs'), 'utf8'), 'export const external = true;');
  } finally { await f.cleanup(); }
});

test('bounds reject check tampering, duplicate changes, stale hashes and symlink parents', async () => {
  const f = await setup();
  const outside = await mkdtemp(join(tmpdir(), 'bstae-outside-'));
  try {
    const change = { path: 'value.mjs', content: 'export const value = 2;', expectedHash: fileHash(f.original) };
    await assert.rejects(runProjectAgent({ ...f, changes: [change, change] }), /distinct/);
    await assert.rejects(runProjectAgent({ ...f, changes: [{ ...change, expectedHash: fileHash('stale') }] }), /stale/);
    await assert.rejects(runProjectAgent({ ...f, changes: [change], testFiles: ['value.mjs'] }), /outside this change set/);
    await symlink(outside, join(f.workspace, 'escape'));
    await assert.rejects(runProjectAgent({ ...f, changes: [{ path: 'escape/new.mjs', content: '', expectedHash: null }] }), /workspace/);
  } finally { await f.cleanup(); await rm(outside, { recursive: true, force: true }); }
});

test('HTTP change sets run configured checks despite caller overrides and persist final outcomes', async () => {
  const f = await setup();
  const token = '1234567890abcdef';
  const composed = createBiktingServer({ env: { BIKTING_TEST_TOKEN: token, BIKTING_AGENT_WORKSPACE: f.workspace,
    BIKTING_AGENT_TEST_FILES: JSON.stringify(['verify.mjs']), KNOWLEDGE_STORE_PATH: join(f.workspace, 'memory.json') } });
  await new Promise(resolve => composed.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${composed.server.address().port}/api/agent/project`;
  const post = (value, authorized = true) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(authorized ? { 'x-bikting-test-token': token } : {}) },
    body: JSON.stringify({ changes: [{ path: 'value.mjs', content: `export const value = ${value};`, expectedHash: fileHash(f.original) }], testFiles: [] }) });
  try {
    assert.equal((await post(2, false)).status, 401);
    const failed = await (await post(3)).json();
    assert.equal(failed.status, 'failed');
    assert.equal(failed.rollback.status, 'restored');
    const completed = await (await post(2)).json();
    assert.equal(completed.status, 'completed');
    assert.equal(completed.checks.projectTestsPassed, true);
    assert.equal(completed.modelCalls, 0);
    const stored = JSON.parse(await readFile(join(f.workspace, 'memory.json'), 'utf8'));
    assert.ok(stored.some(item => item.value.runId === failed.runId && item.value.status === 'failed'));
    assert.ok(stored.some(item => item.value.runId === completed.runId && item.value.status === 'completed'));
    assert.equal((await post(2)).status, 409);
  } finally { await new Promise(resolve => composed.server.close(resolve)); await f.cleanup(); }
});
