/** Tools are selected by the artifact they can render, not by a name in the prompt. */
const catalog = [
  { id: 'plotly', name: 'Plotly.js', status: 'available', domains: ['mathematics', 'statistics', 'physics', 'business', 'data'], artifacts: ['graph', 'interactive_chart'], runtime: 'browser', requirement: null },
  { id: 'bikting.svg-plot', name: 'Bikting SVG Plot', status: 'available', domains: ['mathematics', 'statistics', 'physics', 'data'], artifacts: ['graph'], runtime: 'browser', requirement: null },
  { id: 'bikting.relationship-diagram', name: 'Bikting Relationship Diagram', status: 'available', domains: ['general'], artifacts: ['diagram'], runtime: 'browser', requirement: null },
  { id: 'matplotlib', name: 'Matplotlib', status: 'integration_needed', domains: ['mathematics', 'statistics', 'physics', 'data'], artifacts: ['graph', 'scientific_figure'], runtime: 'python', requirement: 'Python renderer with Matplotlib installed' },
  { id: 'threejs', name: 'Three.js', status: 'integration_needed', domains: ['physics', 'engineering', 'biology', 'astronomy', 'geometry'], artifacts: ['3d_scene'], runtime: 'browser', requirement: 'Three.js adapter and validated 3D assets' },
  { id: 'molstar', name: 'Mol*', status: 'integration_needed', domains: ['biology', 'chemistry'], artifacts: ['molecular_structure'], runtime: 'browser', requirement: 'Mol* adapter and a source structure file' },
  { id: 'maplibre', name: 'MapLibre GL JS', status: 'integration_needed', domains: ['geography', 'history', 'environment'], artifacts: ['map'], runtime: 'browser', requirement: 'MapLibre adapter and map tile source' },
  { id: 'vtkjs', name: 'vtk.js', status: 'integration_needed', domains: ['medicine', 'engineering', 'physics'], artifacts: ['volume'], runtime: 'browser', requirement: 'vtk.js adapter and volumetric dataset' },
  { id: 'cytoscape', name: 'Cytoscape.js', status: 'integration_needed', domains: ['computer_science', 'biology', 'business'], artifacts: ['network'], runtime: 'browser', requirement: 'Cytoscape.js adapter and graph data' },
  { id: 'manim', name: 'Manim', status: 'integration_needed', domains: ['mathematics', 'physics'], artifacts: ['teaching_animation'], runtime: 'python', requirement: 'Python animation worker and render queue' },
];

export function listVisualTools() { return catalog.map((tool) => ({ ...tool, domains: [...tool.domains], artifacts: [...tool.artifacts] })); }

export function selectVisualTool({ domain = 'general', artifact = 'diagram' } = {}) {
  const desiredDomain = String(domain).toLowerCase().replaceAll(' ', '_');
  const desiredArtifact = String(artifact).toLowerCase();
  const matches = catalog.filter((tool) => tool.artifacts.includes(desiredArtifact) && (tool.domains.includes(desiredDomain) || tool.domains.includes('general')));
  const recommended = matches.find((tool) => tool.status === 'integration_needed') ?? null;
  const selected = matches.find((tool) => tool.status === 'available') ?? catalog.find((tool) => tool.status === 'available' && tool.artifacts.includes(desiredArtifact)) ?? catalog.find((tool) => tool.id === 'bikting.relationship-diagram');
  return { selected: { id: selected.id, name: selected.name, status: selected.status }, recommended: recommended && { id: recommended.id, name: recommended.name, status: recommended.status, requirement: recommended.requirement }, requestedArtifact: desiredArtifact };
}
