import type { WorkerModel, WorkerProposal, WorkerFinal } from './llm-worker-bridge';

/** Optional remote worker. Its JSON is untrusted; the bridge enforces all tool authority. */
export function createGeminiWorker(config: { apiKey: string; model: string; fetcher?: typeof fetch }): WorkerModel {
  if (!config.apiKey || !/^[a-zA-Z0-9._-]+$/.test(config.model)) throw new TypeError('Valid Gemini worker configuration required.');
  return { async next(context) {
    const response = await (config.fetcher ?? fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`, {
      method: 'POST', headers: { 'x-goog-api-key': config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: JSON.stringify({ instruction: 'You are a bounded Bikting worker. Return JSON only: {kind:"call",capabilityId,inputs} using an offered tool, or {kind:"final",summary} after an observed verified tool result. Do not claim a tool ran unless an observation says so.', ...context }) }] }], generationConfig: { responseMimeType: 'application/json' } }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Worker model failed (${response.status}).`);
    const body = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const content = body.candidates?.[0]?.content?.parts?.map(({ text }) => text ?? '').join('');
    if (!content || content.length > 10000) throw new Error('Worker returned no bounded JSON.');
    let proposal: unknown;
    try { proposal = JSON.parse(content); } catch { throw new Error('Worker returned invalid JSON.'); }
    if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) throw new Error('Worker returned an invalid proposal.');
    return proposal as WorkerProposal | WorkerFinal;
  } };
}
