import { mockSemanticInterpreter } from '../bikting/core/adapters/mockSemanticInterpreter.js';
import { relationshipTypes } from '../bikting/core/relationships/RelationshipTypeRegistry.js';

const intents = new Set(['explain', 'calculate', 'plot', 'convert_units', 'analyze_dataset', 'write_code', 'unknown']);

export function createGeminiInterpreter({ apiKey, model = 'gemini-2.5-flash', fetchImpl = fetch }) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is required.');
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error('Invalid Gemini model name.');
  return async (request) => {
    const baseline = await mockSemanticInterpreter(request);
    // Deterministic operations use only values extracted from the user's actual input.
    if (['calculate', 'plot', 'convert_units', 'analyze_dataset', 'vector_calculate'].includes(baseline.intent)) return baseline;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
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
        })
      });
    } finally { clearTimeout(timeout); }
    if (!response.ok) {
      if (response.status === 404) {
        let available = [];
        try {
          const modelsResponse = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100', {
            headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(5000)
          });
          if (modelsResponse.ok) {
            const data = await modelsResponse.json();
            available = (data.models ?? []).filter((item) => item.supportedGenerationMethods?.includes('generateContent'))
              .map((item) => item.name?.replace(/^models\//, '')).filter((name) => /^[a-zA-Z0-9._-]+$/.test(name)).slice(0, 8);
          }
        } catch { /* Model discovery is diagnostic only. */ }
        throw new Error(`Gemini model "${model}" was not found for this API key. ${available.length ? `Available generateContent models: ${available.join(', ')}. ` : ''}Check GEMINI_MODEL in Render; use an exact model ID shown in Google AI Studio.`);
      }
      throw new Error(`Gemini request failed (${response.status}). Check API key, quota, and model access.`);
    }
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
      confidence: 0.7, provenance: [{ source: 'gemini', method: 'structured_interpretation' }]
    };
  };
}

function cleanStrings(value, limit) { return (Array.isArray(value) ? value : []).filter((item) => typeof item === 'string').map((item) => item.slice(0, 80).trim()).filter(Boolean).slice(0, limit); }
function slug(value) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 80); }
