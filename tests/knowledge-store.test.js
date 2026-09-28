import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKnowledgeStore } from '../src/server/knowledgeStore.js';
let directory;
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
test('knowledge store persists bounded provider results and expires them', async () => {
  directory = await mkdtemp(join(tmpdir(), 'bikting-knowledge-'));
  let now = 0;
  const filePath = join(directory, 'knowledge.json');
  const first = createKnowledgeStore({ filePath, ttlMs: 100, maxEntries: 2, now: () => now });
  await first.set('cell', { relationships: [{ from: 'cell', to: 'cytoplasm' }] });
  const second = createKnowledgeStore({ filePath, ttlMs: 100, maxEntries: 2, now: () => now });
  assert.deepEqual(await second.get('cell'), { relationships: [{ from: 'cell', to: 'cytoplasm' }] });
  now = 101;
  assert.equal(await second.get('cell'), null);
});

test('interpreter can reuse persisted semantic knowledge after its memory cache is gone', async () => {
  directory = directory ?? await mkdtemp(join(tmpdir(), 'bikting-knowledge-'));
  const filePath = join(directory, 'interpreter.json');
  let calls = 0;
  const response = { candidates: [{ content: { parts: [{ text: JSON.stringify({ intent: 'explain', domain: 'biology', concepts: ['cell'], relationships: [], explanation: 'A cell is a basic unit of life.' }) }] } }] };
  const fetchImpl = async () => { calls += 1; return { ok: true, status: 200, json: async () => response }; };
  const { createGeminiInterpreter } = await import('../src/server/geminiInterpreter.js');
  const first = createGeminiInterpreter({ apiKey: 'test', fetchImpl, knowledgeStore: createKnowledgeStore({ filePath }) });
  await first({ text: 'Explain a biological cell' });
  const second = createGeminiInterpreter({ apiKey: 'test', fetchImpl, knowledgeStore: createKnowledgeStore({ filePath }) });
  const reused = await second({ text: 'Explain a biological cell' });
  assert.equal(calls, 1);
  assert.equal(reused.context.geminiExplanation, 'A cell is a basic unit of life.');
});
