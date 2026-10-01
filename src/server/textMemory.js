import { createHash } from 'node:crypto';

/** Exact, expiring reuse of read-only model text. Never a factual truth store. */
export function createTextMemory({ knowledgeStore, onMemoryHit = () => {} }) {
  const pending = new Map();
  const reuse = result => {
    onMemoryHit();
    return { ...structuredClone(result), memory: { reused: true, match: 'exact', factualVerification: false },
      modelUsage: { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, cacheHit: true } };
  };
  return {
    async resolve(specification, generate) {
      const key = `text-memory:v1:${createHash('sha256').update(JSON.stringify(specification)).digest('hex')}`;
      const saved = await knowledgeStore?.get(key);
      if (saved?.type === 'text_result' && typeof saved.text === 'string' && saved.text.trim()) return reuse(saved);
      if (pending.has(key)) return reuse(await pending.get(key));
      const work = (async () => {
        const result = await generate();
        if (result.type === 'text_result' && typeof result.text === 'string' && result.text.trim()) await knowledgeStore?.set(key, result);
        return result;
      })();
      pending.set(key, work);
      try { return structuredClone(await work); }
      finally { pending.delete(key); }
    },
  };
}
