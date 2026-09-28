/** Preserve provider evidence separately from model-proposed relationships. */
export function readGrounding(payload) {
  const candidate = payload.candidates?.[0] ?? {};
  const metadata = candidate.groundingMetadata ?? {};
  const sources = (metadata.groundingChunks ?? []).map((chunk, index) => {
    try { const url = new URL(chunk.web?.uri); if (!['https:', 'http:'].includes(url.protocol)) return null;
      return { id: index, title: String(chunk.web.title || url.hostname), url: url.href };
    } catch { return null; }
  }).filter(Boolean);
  const supports = (metadata.groundingSupports ?? []).map(support => ({ text: String(support.segment?.text ?? ''), sourceIds: (support.groundingChunkIndices ?? []).filter(id => sources.some(s => s.id === id)) })).filter(s => s.text && s.sourceIds.length);
  return { mode: sources.length ? 'web-grounded' : 'model', retrievedAt: new Date().toISOString(), text: candidate.content?.parts?.map(p => p.text ?? '').join('') ?? '', sources, supports, searchSuggestions: metadata.searchEntryPoint?.renderedContent ?? '', warning: sources.length ? 'Sources support the research notes. Extracted relationships remain model proposals, not independently verified facts.' : 'No web sources were returned. This knowledge is model-generated.' };
}
