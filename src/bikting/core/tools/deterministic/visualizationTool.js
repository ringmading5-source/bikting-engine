export const structuredVisualizationTool = {
  id: 'visualization.structured-scene', name: 'Structured visualization builder', domain: 'visualization',
  capabilities: [{ id: 'visual.scene', aliases: ['render_structured_scene'], operation: 'render_structured_scene', acceptedInputs: ['semantic.relationships', 'plotData'], producedOutputs: ['structured_scene'], executionMode: 'deterministic', visual: true }],
  operations: ['render_structured_scene'], deterministic: true,
  async execute({ plotData, semantic } = {}, context = {}) {
    const sourceSemantic = semantic ?? context.semanticObject;
    const graph = plotData?.structuredVisualScenes ?? plotData;
    if (graph?.type === 'graph' && Array.isArray(graph.series)) return { type: 'visual_scene', structuredVisualScenes: { ...graph, source: { type: 'tool', id: this.id, deterministic: true } }, deterministic: true };
    const entities = sourceSemantic?.entities ?? [];
    const scene = { type: 'diagram', objects: entities.map(({ id, label, type }) => ({ id, label, type })), relationships: (sourceSemantic?.relationships ?? []).map(({ from, relation, to }) => ({ from, relation, to })), animations: [], camera: { projection: '2d', fit: 'content' }, source: { type: 'tool', id: this.id, deterministic: true } };
    return { type: 'visual_scene', structuredVisualScenes: scene, deterministic: true };
  },
};
