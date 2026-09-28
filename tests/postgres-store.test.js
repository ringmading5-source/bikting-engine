import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresKnowledgeStore } from '../src/server/postgresKnowledgeStore.js';

test('Postgres store uses parameterized keys and persists validated memory and pilot feedback across instances', async () => {
  const records = new Map(), pilots = new Map(), queries = [];
  const pool = { async query(sql, params = []) {
    queries.push({ sql, params });
    if (sql.startsWith('CREATE TABLE')) return { rows: [] };
    if (sql.startsWith('INSERT INTO bikting_kv')) { records.set(params[0], { value: JSON.parse(params[1]), expiresAt: params[2] }); return { rows: [] }; }
    if (sql.startsWith('SELECT value')) { const record = records.get(params[0]); return { rows: record?.expiresAt > params[1] ? [{ value: record.value }] : [] }; }
    if (sql.startsWith('INSERT INTO bikting_pilot_runs')) { pilots.set(params[0], JSON.parse(params[1])); return { rows: [], rowCount: 1 }; }
    if (sql.startsWith('UPDATE bikting_pilot_runs')) { const run = pilots.get(params[0]); if (!run) return { rowCount: 0 }; Object.assign(run, JSON.parse(params[1])); return { rowCount: 1 }; }
    if (sql.startsWith('SELECT record')) return { rows: [...pilots.values()].map(record => ({ record })) };
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const first = createPostgresKnowledgeStore({ pool, now: () => 1000, ttlMs: 1000 });
  await first.set('private request', { answer: 'validated' });
  const second = createPostgresKnowledgeStore({ pool, now: () => 1500, ttlMs: 1000 });
  assert.deepEqual(await second.get('private request'), { answer: 'validated' });
  assert.ok(!queries.some(({ params }) => params.includes('private request')));
  const run = { id: 'c2d66518-b8d1-4986-9365-391020e3d52a', createdAt: new Date().toISOString(), taskType: 'website', status: 'completed', validated: true,
    modelCalls: 1, inputTokens: 100, outputTokens: 30, estimatedCostUsd: .0001, cacheHit: false, rating: null, completedByUser: null };
  await first.recordPilot(run);
  assert.equal(await second.feedbackPilot(run.id, { rating: 5, completedByUser: true }), true);
  const summary = await first.pilotSummary();
  assert.equal(summary.byTask.website.feedbackCount, 1); assert.equal(summary.byTask.website.userCompletionRate, 1);
  const expired = createPostgresKnowledgeStore({ pool, now: () => 3000, ttlMs: 1000 });
  assert.equal(await expired.get('private request'), null);
});
