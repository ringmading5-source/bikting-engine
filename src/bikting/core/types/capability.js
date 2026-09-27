const defaults = {
  'math.calculate': ['mathematics', 'calculate', ['equation', 'numeric_result', 'graph', 'geometry'], 'deterministic', true, true, false],
  'physics.represent': ['physics', 'simulate_physics', ['physical_state', 'vectors', 'fields', 'structured_visual_data'], 'deterministic', true, true, false],
  'statistics.analyze': ['statistics', 'analyze', ['statistical_analysis', 'trend_analysis'], 'deterministic', false, true, false],
  'code.execute': ['coding', 'execute', ['execution_result'], 'deterministic', false, true, false],
  'visual.scene': ['visualization', 'render_structured_scene', ['structured_scene'], 'deterministic', true, false, false],
  'text.generate': ['language', 'explain', ['explanation'], 'generative', false, false, true],
  'voice.synthesize': ['voice', 'speak', ['audio'], 'generative', false, false, true],
  'vision.interpret': ['vision', 'interpret', ['visual_semantics'], 'generative', false, false, false],
  'image.generate': ['image', 'generate_image', ['image'], 'generative', true, false, false],
};

/** Expand a capability id into the common capability contract, preserving adapter overrides. */
export function normalizeCapability(definition, adapter = {}) {
  const supplied = typeof definition === 'string' ? { id: definition } : definition;
  if (!supplied?.id) throw new TypeError('Every capability needs an id.');
  const preset = defaults[supplied.id] ?? [];
  const [defaultDomain, defaultOperation, defaultOutputs, executionMode, visual, computational, explanatory] = preset;
  return {
    id: supplied.id,
    domain: supplied.domain ?? defaultDomain ?? adapter.domain ?? 'general',
    operation: supplied.operation ?? defaultOperation ?? supplied.id.split('.').at(-1),
    aliases: [...(supplied.aliases ?? [])],
    acceptedInputs: [...(supplied.acceptedInputs ?? adapter.inputRequirements ?? ['semantic_object'])],
    producedOutputs: [...(supplied.producedOutputs ?? defaultOutputs ?? adapter.outputTypes ?? [])],
    executionMode: supplied.executionMode ?? supplied.deterministicOrGenerative ?? executionMode ?? 'deterministic',
    visual: supplied.visual ?? visual ?? false,
    computational: supplied.computational ?? computational ?? false,
    explanatory: supplied.explanatory ?? explanatory ?? false,
    executionRequirements: [...(supplied.executionRequirements ?? [])],
    metadata: { ...(supplied.metadata ?? {}) },
  };
}

export function capabilityMatches(definition, query) {
  const value = typeof query === 'string' ? query : query?.id ?? query?.operation;
  return definition.id === value || definition.operation === value || definition.aliases.includes(value);
}
