import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCodingAgent, fileHash } from '../src/server/codingAgent.js';
import { createRelationalMemory } from '../src/server/relationalMemory.js';

async function memory() {
  const records = new Map();
  const memory = createRelationalMemory({ knowledgeStore: { get: async key => records.get(key), set: async (key, value) => records.set(key, structuredClone(value)) } });
  for (const record of [
    { id: 'edit', tool: 'file.replace', preconditions: { fileMatches: false }, effects: { fileMatches: true } },
    { id: 'check', tool: 'file.syntax-check', preconditions: { fileMatches: true }, effects: { syntaxValid: true } },
  ]) await memory.put({ ...record, kind: 'procedure', text: record.id, queries: [], source: 'test:runbook', review: 'approved', context: { agent: 'coding-v1' }, expiresAt: Date.now() + 60000 });
  return memory;
}

test('coding agent edits a real file then verifies syntax without executing its code', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'bstae-code-'));
  try {
    const original = 'export const value = 1;\n';
    const content = 'throw Error("must not run");\n';
    await writeFile(join(workspace, 'app.mjs'), original);
    const result = await runCodingAgent({ workspace, memory: await memory(), path: 'app.mjs', content, expectedHash: fileHash(original) });
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.trace.map(step => step.tool), ['file.replace', 'file.syntax-check']);
    assert.equal(await readFile(join(workspace, 'app.mjs'), 'utf8'), content);
    assert.equal(result.modelCalls, 0);
    await assert.rejects(runCodingAgent({ workspace, memory: await memory(), path: 'app.mjs', content, expectedHash: fileHash(original) }), /changed/);
    const invalid = await runCodingAgent({ workspace, memory: await memory(), path: 'app.mjs', content: 'const = ;', expectedHash: fileHash(content) });
    assert.equal(invalid.status, 'failed');
    assert.equal(invalid.state.syntaxValid, false);
    assert.equal(await readFile(join(workspace, 'app.mjs'), 'utf8'), content);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('coding paths cannot escape through traversal, absolute paths or symlinks', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'bstae-bound-'));
  const { mkdir } = await import('node:fs/promises');
  const workspace = join(folder, 'workspace'); await mkdir(workspace);
  const outside = join(folder, 'outside.js'); await writeFile(outside, 'const x = 1;');
  await symlink(outside, join(workspace, 'link.js'));
  try {
    for (const path of ['../outside.js', outside, 'link.js']) await assert.rejects(runCodingAgent({ workspace, memory: await memory(), path, content: 'const x = 2;', expectedHash: fileHash('const x = 1;') }));
    assert.equal(await readFile(outside, 'utf8'), 'const x = 1;');
  } finally { await rm(folder, { recursive: true, force: true }); }
});
