const positions = [[48, 95], [170, 95], [292, 95], [414, 95], [536, 95], [658, 95]];

export function renderGraph(container, visual, stepIndex = 0) {
  if (!visual) return renderEmpty(container);
  if (visual.type === 'graph' && Array.isArray(visual.series)) return renderPlot(container, visual);
  const normalized = visual.type === 'diagram'
    ? { type: visual.type, nodes: visual.objects ?? [], edges: visual.relationships ?? [], states: [] }
    : visual;
  if (!Array.isArray(normalized.nodes)) return renderEmpty(container);
  return renderRelationshipGraph(container, normalized, stepIndex);
}

function renderRelationshipGraph(container, visual, stepIndex) {
  const width = Math.max(690, 122 * visual.nodes.length + 48);
  const state = visual.states?.[Math.min(stepIndex, visual.states.length - 1)];
  const coords = visual.nodes.map((node, index) => ({ node, x: positions[index]?.[0] ?? 48 + index * 122, y: positions[index]?.[1] ?? 95 }));
  const edges = visual.edges.map((edge, index) => {
    const source = coords.find(({ node }) => node.id === edge.from);
    const target = coords.find(({ node }) => node.id === edge.to);
    if (!source || !target) return '';
    const active = state?.activeNodes.includes(edge.from) && state?.activeNodes.includes(edge.to);
    return `<g><path class="edge ${active ? 'active' : ''}" d="M ${source.x + 49} ${source.y} L ${target.x - 49} ${target.y}" marker-end="url(#arrow)"/><text x="${(source.x + target.x) / 2}" y="${source.y - 12}" class="edge-label">${escapeHtml(edge.relation)}</text></g>`;
  }).join('');
  const nodes = coords.map(({ node, x, y }) => `<g class="node ${state?.activeNodes.includes(node.id) ? 'active' : ''}"><rect x="${x - 49}" y="${y - 25}" width="98" height="50" rx="9"/><text x="${x}" y="${y - 2}">${escapeHtml(node.label)}</text><text x="${x}" y="${y + 13}" class="node-subtitle">${escapeHtml(node.subtitle ?? '')}</text></g>`).join('');
  container.classList.remove('empty-state');
  container.innerHTML = `<svg class="visual-svg" viewBox="0 0 ${width} 190" role="img" aria-label="${escapeHtml(visual.type)}"><defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7" fill="none" stroke="#84978a" stroke-width="1.2"/></marker></defs>${edges}${nodes}</svg>`;
}

function renderPlot(container, graph) {
  const points = graph.series.flatMap((series) => Array.isArray(series.points) ? series.points : []).filter(({ x, y }) => Number.isFinite(x) && Number.isFinite(y));
  if (!points.length) return renderEmpty(container);
  const width = 720; const height = 260; const padding = 36;
  const xValues = points.map(({ x }) => x); const yValues = points.map(({ y }) => y);
  const xRange = range(Math.min(...xValues), Math.max(...xValues));
  const yRange = range(Math.min(...yValues), Math.max(...yValues));
  const coordinate = ({ x, y }) => `${padding + ((x - xRange.min) / (xRange.max - xRange.min)) * (width - padding * 2)},${height - padding - ((y - yRange.min) / (yRange.max - yRange.min)) * (height - padding * 2)}`;
  const series = graph.series.map((item) => `<polyline class="edge active" fill="none" points="${item.points.filter(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)).map(coordinate).join(' ')}"/>`).join('');
  container.classList.remove('empty-state');
  container.innerHTML = `<svg class="visual-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(graph.type)}"><path class="edge" d="M ${padding} ${height - padding} H ${width - padding} M ${padding} ${height - padding} V ${padding}"/>${series}<text x="${padding}" y="${height - 10}" class="edge-label">${escapeHtml(String(xRange.min))}</text><text x="${width - padding}" y="${height - 10}" class="edge-label">${escapeHtml(String(xRange.max))}</text><text x="${padding + 4}" y="${padding + 12}" class="edge-label">${escapeHtml(String(yRange.max))}</text></svg>`;
}

function renderEmpty(container) {
  container.classList.add('empty-state');
  container.innerHTML = '<div class="empty-orbit">b</div><p>No structured visual output was produced.</p>';
}

function range(minimum, maximum) {
  if (minimum === maximum) return { min: minimum - 1, max: maximum + 1 };
  return { min: minimum, max: maximum };
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
