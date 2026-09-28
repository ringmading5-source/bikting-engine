import { mockSemanticInterpreter } from '../bikting/core/adapters/mockSemanticInterpreter.js';
import { relationshipTypes } from '../bikting/core/relationships/RelationshipTypeRegistry.js';

const intents = new Set(['explain', 'calculate', 'plot', 'convert_units', 'analyze_dataset', 'write_code', 'unknown']);

export function createGeminiInterpreter({ apiKey, model = 'gemini-2.5-flash', fetchImpl = fetch }) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is required.');
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error('Invalid Gemini model name.');
  let selectedModel = model;
  return async (request) => {
    const baseline = await mockSemanticInterpreter(request);
    // Deterministic operations use only values extracted from the user's actual input.
    if (['calculate', 'plot', 'convert_units', 'analyze_dataset', 'vector_calculate'].includes(baseline.intent)) return baseline;
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: 'Interpret the user request for Bikting. Return a short factual explanation and semantic labels. Never claim to have executed tools, built a website, accessed accounts, or verified facts. Only include relationships clearly supported by the request. Do not include executable code or numeric tool inputs.' }] },
      contents: [{ role: 'user', parts: [{ text: request.text }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: {
        type: 'OBJECT', properties: {
          intent: { type: 'STRING', enum: ['explain', 'write_code', 'unknown'] },
          domain: { type: 'STRING' }, concepts: { type: 'ARRAY', items: { type: 'STRING' } },
          relationships: { type: 'ARRAY', items: { type: 'OBJECT', properties: { from: { type: 'STRING' }, relation: { type: 'STRING' }, to: { type: 'STRING' } }, required: ['from', 'relation', 'to'] } },
          explanation: { type: 'STRING' }
        }, required: ['intent', 'domain', 'concepts', 'relationships', 'explanation']
      } }
    });
    const generate = (id) => fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${id}:generateContent`, {
        method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body
      });
    let response = await generate(selectedModel);
    if (response.status === 404) {
      const available = await listTextModels(fetchImpl, apiKey);
      const tried = [selectedModel];
      for (const candidate of available) {
        if (candidate === selectedModel) continue;
        tried.push(candidate);
        response = await generate(candidate);
        if (response.ok) { selectedModel = candidate; break; }
        // A bad key, quota, or invalid request cannot be fixed by trying another model.
        if (response.status !== 404) break;
      }
      if (response.status === 404) throw new Error(`No available Gemini text model accepted generateContent. Tried: ${tried.join(', ')}. Check model access in Google AI Studio.`);
    }
    if (!response.ok) throw new Error(`Gemini request failed (${response.status}). Check API key, quota, and model access.`);
    const payload = await response.json();
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('');
    if (!text) throw new Error('Gemini returned no interpretation.');
    const proposed = JSON.parse(text);
    if (!proposed || !intents.has(proposed.intent)) throw new Error('Gemini returned an invalid intent.');
    const concepts = cleanStrings(proposed.concepts, 8);
    const relationships = (Array.isArray(proposed.relationships) ? proposed.relationships : []).slice(0, 12)
      .filter((item) => item && typeof item.from === 'string' && typeof item.to === 'string' && relationshipTypes.has(item.relation))
      .map(({ from, relation, to }) => ({ from: slug(from), relation, to: slug(to) }))
      .filter(({ from, to }) => from && to);
    const labels = [...new Set([...concepts.map(slug), ...relationships.flatMap(({ from, to }) => [from, to])])];
    const explanation = typeof proposed.explanation === 'string' ? proposed.explanation.slice(0, 3000).trim() : '';
    return {
      intent: proposed.intent, modality: 'text', concepts: concepts.map(slug),
      entities: labels.map((id) => ({ id, label: id.replaceAll('_', ' '), type: 'concept' })),
      relationships, variables: {}, equations: [],
      requestedOutputs: ['explanation', 'visual'],
      goals: [request.text], context: { requestText: request.text, domain: String(proposed.domain ?? 'general').slice(0, 40), geminiExplanation: explanation },
      confidence: 0.7, provenance: [{ source: 'gemini', method: 'structured_interpretation', detail: selectedModel }]
    };
  };
}

function cleanStrings(value, limit) { return (Array.isArray(value) ? value : []).filter((item) => typeof item === 'string').map((item) => item.slice(0, 80).trim()).filter(Boolean).slice(0, limit); }
function slug(value) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 80); }

async function listTextModels(fetchImpl, apiKey) {
  const names = new Set();
  let pageToken;
  for (let page = 0; page < 10; page++) {
    const query = new URLSearchParams({ pageSize: '100', ...(pageToken ? { pageToken } : {}) });
    let response;
    try { response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models?${query}`, { headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(5000) }); }
    catch { break; }
    if (!response.ok) break;
    const data = await response.json();
    for (const item of data.models ?? []) {
      const name = item.name?.replace(/^models\//, '');
      if (item.supportedGenerationMethods?.includes('generateContent') && /^gemini-[a-zA-Z0-9._-]+$/.test(name) && !/(image|audio|live|tts|embed|transcribe|computer-use)/i.test(name)) names.add(name);
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  const preferred = ['gemini-2.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];
  return [...names].sort((a, b) => {
    const rank = (name) => preferred.includes(name) ? preferred.indexOf(name) : /flash-lite/.test(name) ? 10 : /flash/.test(name) ? 20 : 30;
    return rank(a) - rank(b) || a.localeCompare(b);
  });
}
