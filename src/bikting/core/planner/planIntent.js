import { normalizeCapability } from '../types/capability.js';

const capabilityOrder = ['data.generate_range', 'physics.calculate_force', 'physics.calculate_force_series', 'physics.represent', 'vector.calculate', 'math.calculate', 'statistics.analyze', 'units.convert', 'code.execute', 'website.build', 'website.deploy', 'artifact.build', 'visual.scene', 'text.generate', 'voice.synthesize', 'vision.interpret'];

/** Build an ordered, capability-backed plan from structured semantic fields. */
export function planIntent(semantic, registries = {}) {
  const desired = deriveRequiredCapabilities(semantic);
  const catalog = registries.catalog ?? [];
  const requirements = capabilityOrder.filter((id) => desired.has(id)).map((id) => {
    const definition = catalog.find((item) => item.id === id || item.aliases?.includes(id)) ?? defaultDefinition(id);
    const availableTools = registries.tools?.findByCapability(id) ?? [];
    const availableModels = registries.models?.findByCapability(id) ?? [];
    const matches = (adapter) => adapter.capabilityDefinitions.some((item) => (item.id === id || item.operation === definition.operation) && item.executionMode === definition.executionMode);
    const matchingTools = availableTools.filter(matches);
    const matchingModels = availableModels.filter(matches);
    const preferred = definition.executionMode === 'deterministic' ? matchingTools : matchingModels;
    const fallback = definition.executionMode === 'deterministic' ? [] : matchingTools;
    const selectedProvider = preferred[0] ?? fallback[0];
    const tools = selectedProvider && availableTools.includes(selectedProvider) ? [selectedProvider] : [];
    const models = selectedProvider && availableModels.includes(selectedProvider) ? [selectedProvider] : [];
    const providers = [...tools.map((tool) => ({ id: tool.id, kind: 'tool', domain: tool.domain })), ...models.map((model) => ({ id: model.id, kind: 'model', domain: model.domain }))];
    const access = accessFor(id);
    return { ...definition, requiredCapability: id, providers, status: providers.length ? 'available' : 'unavailable', access };
  });
  const reqById = new Map(requirements.map((item) => [item.requiredCapability, item]));
  const steps = [];
  if (semantic.intent === 'explain' || semantic.requestedOutputs.includes('explanation')) addBuiltin(steps, 'explain_concept', { concepts: semantic.concepts });
  if (semantic.relationships.length) addBuiltin(steps, 'establish_relationships', { relationships: semantic.relationships.map(({ from, relation, to }) => ({ from, relation, to })) });

  if (isForceRangeRequest(semantic)) {
    addStep(steps, reqById.get('data.generate_range'), { id: 'input-generation', operation: 'generate_values', inputMapping: { start: '$semantic.variables.massStart', end: '$semantic.variables.massEnd', step: '$semantic.variables.massStep' } });
    addStep(steps, reqById.get('physics.calculate_force_series'), { id: 'physics-calculation', operation: 'calculate_force_series', dependsOn: ['input-generation'], inputMapping: { operation: 'calculate_force_series', masses: '$results.input-generation.values', acceleration: '$semantic.variables.acceleration' } });
    addStep(steps, reqById.get('math.calculate'), { id: 'plot-generation', operation: 'plot_series', dependsOn: ['input-generation', 'physics-calculation'], inputMapping: { operation: 'plot_series', xValues: '$results.input-generation.values', yValues: '$results.physics-calculation.values', expression: 'F = m * a' } });
    addStep(steps, reqById.get('visual.scene'), { id: 'visual-output', operation: 'render_structured_scene', dependsOn: ['plot-generation'], inputMapping: { plotData: '$results.plot-generation.structuredVisualScenes' } });
  } else {
    for (const requirement of requirements) {
      const operation = operationFor(requirement, semantic);
      const step = { id: `step-${requirement.requiredCapability.replaceAll('.', '-')}`, operation, capability: requirement.requiredCapability, expectedOutputs: requirement.producedOutputs, providers: requirement.providers, status: requirement.status };
      if (requirement.requiredCapability === 'math.calculate') step.inputMapping = mathInput(semantic);
      if (requirement.requiredCapability === 'vector.calculate') step.inputMapping = { operation: '$semantic.variables.vectorOperation', vectorA: '$semantic.variables.vectorA', vectorB: '$semantic.variables.vectorB' };
      if (requirement.requiredCapability === 'physics.calculate_force') step.inputMapping = { operation: 'calculate_force', variables: '$semantic.variables' };
      if (requirement.requiredCapability === 'statistics.analyze') step.inputMapping = { data: '$semantic.variables.data', otherData: '$semantic.variables.otherData', statistic: '$semantic.variables.statistic' };
      if (requirement.requiredCapability === 'units.convert') step.inputMapping = { value: '$semantic.variables.value', fromUnit: '$semantic.variables.fromUnit', toUnit: '$semantic.variables.toUnit' };
      if (requirement.requiredCapability === 'website.build') step.inputMapping = { title: '$semantic.variables.siteTitle', kind: '$semantic.variables.siteKind', html: '$semantic.variables.generatedHtml', generationStatus: '$semantic.variables.generationStatus', buildPlan: '$semantic.context.buildPlan' };
      if (requirement.requiredCapability === 'visual.scene' && semantic.intent === 'plot') step.inputMapping = { plotData: `$results.${stepId('math.calculate')}.structuredVisualScenes` };
      if (requirement.requiredCapability === 'visual.scene' && semantic.intent === 'plot') step.dependsOn = [stepId('math.calculate')];
      steps.push(step);
    }
  }
  if (desired.has('voice.synthesize') && desired.has('visual.scene')) addBuiltin(steps, 'synchronize_narration_with_visual_state', { dependsOn: [stepId('voice.synthesize'), stepId('visual.scene')] });
  steps.forEach((step, index) => { step.order = index + 1; });
  return {
    id: `plan-${semantic.id}`, intent: semantic.intent, semanticId: semantic.id,
    requiredCapabilities: requirements, capabilities: requirements.map(({ requiredCapability }) => requiredCapability), steps,
    visualPolicy: 'deterministic_or_domain_renderer_by_default', createdAt: new Date().toISOString(),
  };
}
function accessFor(capability) {
  if (capability === 'website.deploy') return { status: 'authorization_required', authorizationType: 'account', provider: 'Render or GitHub', nextAction: 'Connect a Render or GitHub account before deployment.' };
  if (capability === 'artifact.build') return { status: 'authorization_required', authorizationType: 'account', provider: 'connected build provider', nextAction: 'Connect an account for a provider that can build this artifact.' };
  return { status: 'none', authorizationType: 'none' };
}

/** Planner decisions are based on semantic data, never raw request text. */
export function deriveRequiredCapabilities(semantic) {
  const required = new Set();
  const outputs = new Set(semantic.requestedOutputs ?? []);
  const concepts = new Set((semantic.concepts ?? []).map(normalize));
  const domain = normalize(semantic.context?.domain ?? '');
  const intent = normalize(semantic.intent ?? '');
  const relationships = semantic.relationships ?? [];
  const variables = semantic.variables ?? {};
  const numericRequest = intent === 'calculate' || intent === 'plot' || intent === 'solve' || outputs.has('numeric_result') || outputs.has('equation') || outputs.has('graph');

  if (intent === 'convert_units' || outputs.has('unit_conversion')) required.add('units.convert');
  else if (intent === 'vector_calculate') required.add('vector.calculate');
  else if (isForceRangeRequest(semantic)) {
    required.add('data.generate_range'); required.add('physics.calculate_force_series'); required.add('math.calculate'); required.add('visual.scene');
  } else if (concepts.has('force') && Number.isFinite(Number(variables.mass)) &…5506 tokens truncated…s = new Set(['diagram', 'graph', 'interactive_chart', 'scientific_figure', '3d_scene', 'molecular_structure', 'map', 'network', 'volume', 'teaching_animation']);

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
