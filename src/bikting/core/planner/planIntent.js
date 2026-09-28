import { normalizeCapability } from '../types/capability.js';

const capabilityOrder = ['data.generate_range', 'physics.calculate_force', 'physics.calculate_force_series', 'physics.represent', 'vector.calculate', 'math.calculate', 'statistics.analyze', 'units.convert', 'code.execute', 'visual.scene', 'text.generate', 'voice.synthesize', 'vision.interpret'];

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
    return { ...definition, requiredCapability: id, providers, status: providers.length ? 'available' : 'unavailable' };
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

  const structuredForceCalculation = concepts.has('force') && Number.isFinite(Number(variables.mass)) && Number.isFinite(Number(variables.acceleration)) && numericRequest;
  if ((domain === 'physics' && !structuredForceCalculation && !isForceRangeRequest(semantic)) || outputs.has('physical_state') || outputs.has('vectors') || outputs.has('fields') || concepts.has('electric_motor')) required.add('physics.represent');
  if (domain === 'statistics' || domain === 'data' || intent === 'analyze_dataset' || outputs.has('statistical_analysis') || outputs.has('trend_analysis')) required.add('statistics.analyze');
  if (domain === 'coding' || intent === 'write_code' || outputs.has('code')) required.add('code.execute');
  if (outputs.has('visual') || outputs.has('graph') || outputs.has('structured_visual_data') || outputs.has('structured_scene') || domain === 'visualization' || relationships.length) required.add('visual.scene');
  if (intent === 'explain' || outputs.has('explanation')) required.add('text.generate');
  if (outputs.has('voice') || outputs.has('audio')) required.add('voice.synthesize');
  if (semantic.modality === 'vision' || outputs.has('visual_semantics') || intent === 'interpret_visual') required.add('vision.interpret');

  if (domain === 'physics' && ['force', 'mass', 'acceleration'].every((concept) => concepts.has(concept)) && !structuredForceCalculation) required.add('math.calculate');
  if (domain === 'physics' && relationships.length >= 4) required.add('math.calculate');
  return required;
}

function isForceRangeRequest(semantic) { return Number.isFinite(Number(semantic.variables?.massStart)) && Number.isFinite(Number(semantic.variables?.massEnd)) && Number.isFinite(Number(semantic.variables?.acceleration)) && semantic.requestedOutputs?.includes('graph'); }
function operationFor(requirement, semantic) {
  if (requirement.requiredCapability === 'math.calculate' && semantic.intent === 'plot') return 'plot_equation';
  return ({ 'physics.represent': 'physics_representation', 'physics.calculate_force': 'calculate_force', 'physics.calculate_force_series': 'calculate_force_series', 'data.generate_range': 'generate_values', 'math.calculate': 'calculate', 'statistics.analyze': 'analyze', 'units.convert': 'convert', 'code.execute': 'execute_code', 'visual.scene': 'render_structured_scene', 'text.generate': 'generate_explanation', 'voice.synthesize': 'generate_voice_narration', 'vision.interpret': 'interpret_vision' })[requirement.requiredCapability] ?? requirement.operation;
}
function mathInput(semantic) {
  if (semantic.intent === 'plot') return { operation: 'plot_equation', expression: semantic.equations[0], xMin: semantic.variables.xMin ?? -10, xMax: semantic.variables.xMax ?? 10, sampleCount: semantic.variables.sampleCount ?? 41 };
  return { operation: 'calculate', expression: '$semantic.variables.expression', variables: '$semantic.variables' };
}
function addBuiltin(steps, operation, properties) { steps.push({ id: `step-${operation}`, operation, provider: 'engine', status: 'ready', ...properties }); }
function addStep(steps, requirement, overrides) { if (!requirement) throw new Error('Plan is missing a required registered capability.'); steps.push({ capability: requirement.requiredCapability, expectedOutputs: requirement.producedOutputs, providers: requirement.providers, status: requirement.status, ...overrides }); }
function stepId(capability) { return `step-${capability.replaceAll('.', '-')}`; }
function normalize(value) { return String(value).toLowerCase().replaceAll('-', '_').replaceAll(' ', '_'); }
function defaultDefinition(id) { return normalizeCapability(id); }
