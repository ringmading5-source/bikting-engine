import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

/** Small bounded JSON store for reusable provider knowledge. Replace with a database adapter in production. */
export function createKnowledgeStore({ filePath, ttlMs = 86_400_000, maxEntries = 100, now = Date.now } = {}) {
  const entries = new Map();
  let loaded;
  const load = async () => {
    if (loaded) return loaded;
    loaded = (async () => {
      if (!filePath) return;
      try {
        const parsed = JSON.parse(await readFile(filePath, 'utf8'));
        for (const item of Array.isArray(parsed) ? parsed : []) if (item?.key && item?.value && now() - item.savedAt < ttlMs) entries.set(item.key, item);
      } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    })();
    return loaded;
  };
  const persist = async () => {
    if (!filePath) return;
    await mkdir(dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    await writeFile(temporary, JSON.stringify([...entries.values()].slice(-maxEntries)), 'utf8');
    await rename(temporary, filePath);
  };
  return {
    async get(rawKey) { await load(); const key = hashKey(rawKey); const item = entries.get(key); if (!item) return null; if (now() - item.savedAt >= ttlMs) { entries.delete(key); await persist(); return null; } return structuredClone(item.value); },
    async set(rawKey, value) { await load(); const key = hashKey(rawKey); entries.set(key, { key, savedAt: now(), value: structuredClone(value) }); while (entries.size > maxEntries) entries.delete(entries.keys().next().value); await persist(); },
    async clear() { await load(); entries.clear(); await persist(); },
    size() { return entries.size; },
  };
}

function hashKey(value) { return createHash('sha256').update(String(value)).digest('hex'); }
