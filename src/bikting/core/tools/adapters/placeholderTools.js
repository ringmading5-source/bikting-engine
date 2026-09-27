function placeholder(id, name, domain, capability, outputType) {
  return { id, name, domain, capabilities: [capability], inputRequirements: ['semantic_object'], outputTypes: [outputType], metadata: { adapter: 'placeholder', ready: false }, async execute({ semantic }) { return { status: 'planned', adapter: id, capability, type: outputType, semanticId: semantic.id, message: 'Capability registered; connect a domain execution adapter to run it.' }; } };
}

export const placeholderTools = [
  placeholder('math.placeholder', 'Mathematics adapter', 'mathematics', 'math.calculate', 'calculation'),
  placeholder('physics.placeholder', 'Physics adapter', 'physics', 'physics.represent', 'physics_representation'),
  placeholder('statistics.placeholder', 'Statistics adapter', 'statistics', 'statistics.analyze', 'statistical_analysis'),
  placeholder('visualization.placeholder', 'Visualization adapter', 'visualization', 'visual.scene', 'visual_scene'),
  placeholder('code.placeholder', 'Code execution adapter', 'coding', 'code.execute', 'execution_result'),
  placeholder('research.placeholder', 'Research adapter', 'research', 'research.search', 'research_findings'),
];
