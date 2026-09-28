import { selectVisualTool } from '../../../../visualization/visualToolCatalog.js';

export const structuredVisualizationTool = {
  id: 'visualization.structured-scene', name: 'Structured visualization builder', domain: 'visualization',
  capabilities: [{ id: 'visual.scene', aliases: ['render_structured_scene'], operation: 'render_structured_scene', acceptedInputs: ['semantic.relationships', 'plotData'], producedOutputs: ['structured_scene'], executionMode: 'deterministic', visual: true }],
  operations: ['render_structured_scene'], deterministic: true,
  async execute({ plotData, semantic } = {}, context = {}) {
    const sourceSemantic = semantic ?? context.semanticObject;
    const graph = plotData?.structuredVisualScenes ?? plotData;
    if (graph?.type === 'graph' && Array.isArray(graph.series)) {
      const count = Math.max(0, ...graph.series.map((series) => series.points?.length ?? 0));
      const frames = Array.from({ length: Math.min(12, count) }, (_, index) => ({ pointCount: Math.max(2, Math.ceil(((index + 1) / Math.min(12, count)) * count)) }));
      return { type: 'visual_scene', structuredVisualScenes: { ...graph, states: frames, toolSelection: selectVisualTool({ domain: sourceSemantic?.context?.domain, artifact: 'graph' }), source: { type: 'tool', id: this.id, deterministic: true } }, deterministic: true };
    }
    const entities = sourceSemantic?.entities ?? [];
    const relationships = (sourceSemantic?.relationships ?? []).map(({ from, relation, to }) => ({ from, relation, to }));
    const states = relationships.length
      ? relationships.map((edge, index) => ({ activeNodes: [edge.from, edge.to], activeEdge: index, title: `${label(edge.from)} → ${label(edge.to)}`, text: `${label(edge.from)} ${edge.relation.replaceAll('_', ' ')} ${label(edge.to)}.` }))
      : entities.map(({ id, label: name }) => ({ activeNodes: [id], title: name, text: `Focus on ${name}.` }));
    const scene = { type: 'diagram', objects: entities.map(({ id, label, type }) => ({ id, label, type })), relationships, states, toolSelection: selectVisualTool({ domain: sourceSemantic?.context?.domain, artifact: sourceSemantic?.context?.visualArtifact ?? 'diagram' }), camera: { projection: '2d', fit: 'content' }, source: { type: 'tool', id: this.id, deterministic: true } };
    return { type: 'visual_scene', structuredVisualScenes: scene, deterministic: true };
  },
};

function label(value) { return String(value).replaceAll('_', ' '); }
