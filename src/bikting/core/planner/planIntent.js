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
  } else if (concepts.has('force') && Number.isFinite(Number(variables.mass)) && Number.isFinite(Number(variables.acceleration)) && numericRequest) {
    required.add('physics.calculate_force');
  } else if (numericRequest && !['statistics', 'data'].includes(domain) && intent !== 'vector_calculate') required.add('math.calculate');

  const structuredForceCalculation = concepts.has('force') && Number.isFinite(Number(variables.mass)) && Number.isFini…4987 tokens truncated…segment) {
  if (typeof segment === 'string' && segment.trim()) return { text: segment };
  if (typeof segment?.text === 'string' && segment.text.trim()) return segment;
  return null;
}

function humanize(value) {
  return String(value).replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
