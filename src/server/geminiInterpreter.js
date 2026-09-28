import { mockSemanticInterpreter } from '../bikting/core/adapters/mockSemanticInterpreter.js';
import { relationshipTypes } from '../bikting/core/relationships/RelationshipTypeRegistry.js';
import { compileBehaviorPrompt, programFromRelationships } from '../visualization/behaviorPrompt.js';
import { compileBuildPrompt, validateGeneratedWebsite } from './buildPrompt.js';

const intents = new Set(['explain', 'calculate', 'plot', 'convert_units', 'analyze_dataset', 'write_code', 'unknown']);
const visualArtifacts = new Set(['diagram', 'graph', 'interactive_chart', 'scientific_figure', '3d_scene', 'molecular_structure', 'map', 'network', 'volume', 'teaching_animation']);

export function createGeminiInterpreter({ apiKey, model = 'gemini-2.5-flash', fetchImpl = fetch }) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is required.');
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error('Invalid Gemini model name.');
  let selectedModel = model;
  const interpretationCache = new Map();
  const interpret = async (request) => {
    const baseline = await mockSemanticInterpreter(request);
    if (baseline.context.task?.capability === 'website.build') {
      const prompt = compileBuildPrompt(baseline, request.text);
      try {
        const sketchPart = baseline.context.sketch?.startsWith('data:image/') ? [{ inlineData: { mimeType: 'image/png', data: baseline.context.sketch.split(',')[1] } }] : [];
        const body = JSON.stringify({
          systemInstruction: { parts: [{ text: 'Act as the build executor after Bikting has resolved intent and relationships. Return one self-contained HTML document plus a buildPlan that follows the supplied action, target, relationships, sketch, and directions exactly. Include internal CSS, meaningful responsive layout, and editable placeholders for missing facts. No JavaScript, external resources, forms, invented facts, or claims of deployment.' }] },
          contents: [{ role: 'user', parts: [{ text: prompt }, ...sketchPart] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { html: { type: 'STRING' }, buildPlan: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['html', 'buildPlan'] } }
        });
        const generate = (id) => fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${id}:generateContent`, { method: 'POST', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body });
        let response = await generate(selectedModel);
        if (response.status === 404) {
          for (const candidate of await listTextModels(fetchImpl, apiKey)) {
            if (candidate === selectedModel) continue;
            response = await generate(candidate);
            if (response.ok) { selectedModel = candidate; break; }
            if (response.status !== 404) break;
          }
        }
        if (!response.ok) throw new Error(`Website generation failed (${response.status}).`);
        const payload = await response.json();
        const output = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('');
        const generated = JSON.parse(output);
        const generatedHtml = validateGeneratedWebsite(generated.html);
        const buildPlan = Array.isArray(generated.buildPlan) ? generated.buildPlan.filter((item) => typeof item === 'string').slice(0, 12) : [];
        return withRelationshipProgram({ ...baseline, variables: { ...baseline.variables, generatedHtml, generationStatus: 'generated' }, context: { ...baseline.context, buildPrompt: prompt, buildPlan }, provenance: [{ source: 'gemini', method: 'website_generation', detail: selectedModel }] });
      } catch {
        return withRelationshipProgram({ ...baseline, variables: { ...baseline.variables, generationStatus: 'starter_fallback' }, context: { ...baseline.context, buildPrompt: prompt } });
      }
    }
    // Recognized intents already have structured inputs and registered tool routes.
    if (baseline.context.task || ['calculate', 'plot', 'convert_units', 'analyze_dataset', 'vector_calculate'].includes(baseline.intent) || baseline.concepts.includes('electric_motor') || (baseline.intent === 'explain' && baseline.context.domain === 'physics' && baseline.relationships.length)) {
      return withRelationshipProgram(baseline);
    }
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: 'Interpret the user request for Bikting. Return a short factual explanation and semantic labels. Never claim to have executed tools, built a website, accessed accounts, or verified facts. Only include relationships clearly supported by the request. Do not include executable code or numeric tool inputs.' }] },
      contents: [{ role: 'user', parts: [{ text: request.text }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: {
        type: 'OBJECT', properties: {
          intent: { type: 'STRING', enum: ['explain', 'write_code', 'unknown'] },
          domain: { type: 'STRING' }, visualArtifact: { type: 'STRING', enum: [...visualArtifacts] }, concepts: { type: 'ARRAY', items: { type: 'STRING' } },
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
      .filter(({ from, to }) => from && to)
      .filter((edge, index, all) => all.findIndex((item) => item.from === edge.from && item.relation === edge.relation && item.to === edge.to) === index);
    const labels = [...new Set([...concepts.map(slug), ...relationships.flatMap(({ from, to }) => [from, to])])];
    const explanation = typeof proposed.explanation === 'string' ? proposed.explanation.slice(0, 3000).trim() : '';
    const domain = String(proposed.domain ?? 'general').slice(0, 40);
    const visualArtifact = visualArtifacts.has(proposed.visualArtifact) ? proposed.visualArtifact : 'diagram';
    let visualProgram = null; let visualPrompt = null; let visualProgramStatus = 'not_needed';
    if (relationships.length) {
      const compiled = compileBehaviorPrompt({ domain, artifact: visualArtifact, relationships });
      visualPrompt = compiled.text;
      visualProgram = programFromRelationships(relationships);
      visualProgramStatus = 'relationship_engine';
    }
    return {
      intent: proposed.intent, modality: 'text', concepts: concepts.map(slug),
      entities: labels.map((id) => ({ id, label: id.replaceAll('_', ' '), type: 'concept' })),
      relationships, variables: {}, equations: [],
      requestedOutputs: ['explanation', 'visual'],
      goals: [request.text], context: { requestText: request.text, domain, visualArtifact, geminiExplanation: explanation, visualPrompt, visualProgram, visualProgramStatus },
      confidence: 0.7, provenance: [{ source: 'gemini', method: 'structured_interpretation', detail: selectedModel }]
    };
  };
  return (request) => {
    const key = `${String(request?.text ?? '').trim()}\0${String(request?.sketch ?? '')}\0${JSON.stringify(request?.sketchLayout ?? null)}`;
    if (!key || interpretationCache.has(key)) return interpretationCache.get(key) ?? interpret(request);
    const pending = interpret(request);
    interpretationCache.set(key, pending);
    if (interpretationCache.size > 100) interpretationCache.delete(interpretationCache.keys().next().value);
    pending.catch(() => { if (interpretationCache.get(key) === pending) interpretationCache.delete(key); });
    return pending;
  };
}

function withRelationshipProgram(semantic) {
  if (!semantic.relationships.length) return semantic;
  const visualPrompt = compileBehaviorPrompt({ domain: semantic.context.domain, artifact: 'diagram', relationships: semantic.relationships }).text;
  return { ...semantic, context: { ...semantic.context, visualPrompt, visualProgram: programFromRelationships(semantic.relationships), visualProgramStatus: 'relationship_engine' } };
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
