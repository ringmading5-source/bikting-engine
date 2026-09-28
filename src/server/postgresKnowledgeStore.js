import pg from 'pg';
import { createHash } from 'node:crypto';
import { summarizePilot } from './pilotMetrics.js';

/** Durable replacement for the prototype JSON store. Keys are hashed before leaving the process. */
export function createPostgresKnowledgeStore({ connectionString, ttlMs = 86_400_000, pool = null, now = Date.now } = {}) {
  if (!connectionString && !pool) throw new Error('DATABASE_URL is required for PostgreSQL storage.');
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new RangeError('Storage TTL must be positive.');
  const database = pool ?? new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
  let initialized;
  const ready = () => {
    if (!initialized) initialized = (async () => {
      await database.query('CREATE TABLE IF NOT EXISTS bikting_kv (key_hash text PRIMARY KEY, value jsonb NOT NULL, expires_at timestamptz NOT NULL)');
      await database.query('CREATE TABLE IF NOT EXISTS bikting_pilot_runs (id uuid PRIMARY KEY, record jsonb NOT NULL, created_at timestamptz NOT NULL)');
    })().catch(error => { initialized = null; throw error; });
    return initialized;
  };
  const key = raw => createHash('sha256').update(String(raw)).digest('hex');
  return {
    mode: 'postgres',
    ready,
    async get(rawKey) {
      await ready();
      const result = await database.query('SELECT value FROM bikting_kv WHERE key_hash = $1 AND expires_at > $2', [key(rawKey), new Date(now())]);
      return result.rows[0] ? structuredClone(result.rows[0].value) : null;
    },
    async set(rawKey, value) {
      await ready();
      const serialized = JSON.stringify(value);
      if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > 1_000_000) throw new RangeError('Stored value exceeds the 1 MB limit.');
      await database.query('INSERT INTO bikting_kv (key_hash, value, expires_at) VALUES ($1, $2::jsonb, $3) ON CONFLICT (key_hash) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at', [key(rawKey), serialized, new Date(now() + ttlMs)]);
    },
    async clear() { await ready(); await database.query('DELETE FROM bikting_kv'); },
    async recordPilot(record) { await ready(); await database.query('INSERT INTO bikting_pilot_runs (id, record, created_at) VALUES ($1, $2::jsonb, $3)', [record.id, JSON.stringify(record), record.createdAt]); },
    async feedbackPilot(id, feedback) {
      await ready();
      const result = await database.query('UPDATE bikting_pilot_runs SET record = record || $2::jsonb WHERE id = $1 RETURNING id', [id, JSON.stringify(feedback)]);
      return result.rowCount > 0;
    },
    async pilotSummary() {
      await ready();
      const result = await database.query('SELECT record FROM bikting_pilot_runs ORDER BY created_at DESC LIMIT 1000');
      return summarizePilot(result.rows.map(row => row.record));
    },
    async close() { if (!pool) await database.end(); },
  };
}
