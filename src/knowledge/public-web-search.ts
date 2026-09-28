export interface PublicSearchHit { title: string; snippet: string; url: string; source: 'Wikipedia' }

/** Read-only public lookup; returns source references, not model-generated facts. */
export async function searchPublicKnowledge(topic: unknown, fetcher: typeof fetch = fetch): Promise<{ topic: string; results: PublicSearchHit[]; retrievedAt: string }> {
  if (typeof topic !== 'string' || !topic.trim() || topic.length > 120) throw new TypeError('Enter a topic between 1 and 120 characters.');
  const normalized = topic.trim();
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.search = new URLSearchParams({ action: 'query', list: 'search', srsearch: normalized, srlimit: '5', format: 'json' }).toString();
  const response = await fetcher(url, { headers: { 'User-Agent': 'BiktingEnginePrototype/0.1 (public research prototype)' }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Public knowledge search failed (${response.status}).`);
  const body = await response.json() as { query?: { search?: { title?: string; snippet?: string }[] } };
  if (!Array.isArray(body.query?.search)) throw new Error('Public knowledge source returned an invalid response.');
  const results = body.query.search.filter((hit) => typeof hit.title === 'string').slice(0, 5).map((hit) => ({
    title: hit.title!, snippet: stripMarkup(hit.snippet ?? ''),
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title!.replaceAll(' ', '_'))}`,
    source: 'Wikipedia' as const,
  }));
  return { topic: normalized, results, retrievedAt: new Date().toISOString() };
}

function stripMarkup(value: string): string { return value.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").slice(0, 600); }
