export function renderGraph(container, visual, stepIndex = 0) {
  if (!visual) return renderEmpty(container);
  if (visual.type === 'website' && typeof visual.html === 'string') return renderWebsite(container, visual);
  if (visual.type === 'graph' && Array.isArray(visual.series)) {
    if (visual.toolSelection?.selected?.id === 'plotly' && globalThis.window?.Plotly) return renderPlotly(container, visual, stepIndex);
    return renderPlot(container, visual, stepIndex);
  }
  const normalized = visual.type === 'diagram'
    ? { type: visual.type, nodes: visual.objects ?? [], edges: visual.relationships ?? [], states: visual.states ?? [] }
    : visual;
  if (!Array.isArray(normalized.nodes)) return renderEmpty(container);
  return renderRelationshipGraph(container, normalized, stepIndex);
}

function renderWebsite(container, visual) {
  container.classList.remove('empty-state');
  container.innerHTML = `<div class="website-preview"><a class="website-download" download="website.html" href="#">Download website.html</a><iframe title="Website preview" sandbox="" referrerpolicy="no-referrer" srcdoc="${escapeHtml(visual.html)}"></iframe></div>`;
  const download = container.querySelector?.('.website-download');
  if (download) {
    download.addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([visual.html], { type: 'text/html' }));
      download.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    });
  }
}

function renderRelationshipGraph(container, visual, stepIndex) {
  const columns = Math.min(4, Math.max(1, visual.nodes.length));
  const width = 690;
  const height = Math.max(190, Math.ceil(visual.nodes.length / columns) * 100 + 40);
  const state = visual.states?.[Math.min(stepIndex, visual.states.length - 1)];
  const coords = visual.nodes.map((node, index) => ({ node, x: 92 + (index % columns) * (506 / Math.max(1, columns - 1)), y: 75 + Math.floor(index / columns) * 100 }));
  const edges = visual.edges.map((edge, index) => {
    const source = coords.find(({ node }) => node.id === edge.from);
    const target = coords.find(({ node }) => node.id === edge.to);
    if (!source || !target) return '';
    const active = state?.activeEdge === index;
    const edgeClass = ['edge', active && 'active', active && ['flow', 'pulse'].includes(state?.action) && `behavior-${state.action}`].filter(Boolean).join(' ');
    const dx = target.x - source.x; const dy = target.y - source.y;
    const length = Math.hypot(dx, dy) || 1;
    const inset = 52;
    const x1 = source.x + dx / length * inset; const y1 = source.y + dy / length * inset;
    const x2 = target.x - dx / length * inset; const y2 = target.y - dy / length * inset;
    return `<g><path class="${edgeClass}" d="M ${x1} ${y1} L ${x2} ${y2}" marker-end="url(#arrow)"/><text x="${(source.x + target.x) / 2}" y="${(source.y + target.y) / 2 - 7}" class="edge-label">${escapeHtml(edge.relation.replaceAll('_', ' '))}</text></g>`;
  }).join('');
  const nodes = coords.map(({ node, x, y }) => `<g class="node ${state?.activeNodes.includes(node.id) ? 'active' : ''} ${state?.action === 'pulse' && node.id === visual.edges[state.activeEdge]?.to ? 'behavior-pulse' : ''}"><rect x="${x - 49}" y="${y - 25}" width="98" height="50" rx="9"/><text x="${x}" y="${y - 2}">${escapeHtml(node.label)}</text><text x="${x}" y="${y + 13}" class="node-subtitle">${escapeHtml(node.subtitle ?? '')}</text></g>`).join('');
  container.classList.remove('empty-state');
  container.innerHTML = `<svg class="visual-svg" style="min-width:690px;min-height:${height}px" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(visual.type)}"><defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7" fill="none" stroke="#84978a" stroke-width="1.2"/></marker></defs>${edges}${nodes}</svg>`;
  const active = container.querySelector?.('.node.active');
  active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}

function renderPlot(container, graph, stepIndex) {
  const points = graph.series.flatMap((series) => Array.isArray(series.points) ? series.points : []).filter(({ x, y }) => Number.isFinite(x) && Number.isFinite(y));
  if (!points.length) return renderEmpty(container);
  const width = 720; const height = 260; const padding = 36;
  const xValues = points.map(({ x }) => x); const yValues = points.map(({ y }) => y);
  const xRange = range(Math.min(...xValues), Math.max(...xValues));
  const yRange = range(Math.min(...yValues), Math.max(...yValues));
  const coordinate = ({ x, y }) => `${padding + ((x - xRange.min) / (xRange.max - xRange.min)) * (width - padding * 2)},${height - padding - ((y - yRange.min) / (yRange.max - yRange.min)) * (height - padding * 2)}`;
  const visibleCount = graph.states?.[Math.min(stepIndex, graph.states.length - 1)]?.pointCount ?? Infinity;
  const series = graph.series.map((item) => {
    const visible = item.points.filter(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)).slice(0, visibleCount);
    const current = visible.at(-1);
    const [cx, cy] = current ? coordinate(current).split(',') : [];
    return `<polyline class="edge active" fill="none" points="${visible.map(coordinate).join(' ')}"/>${current ? `<circle class="plot-focus" cx="${cx}" cy="${cy}" r="5"/><text x="${Number(cx) + 9}" y="${Number(cy) - 8}" class="edge-label">(${format(current.x)}, ${format(current.y)})</text>` : ''}`;
  }).join('');
  const xLabel = escapeHtml(graph.axes?.x?.label ?? 'x');
  const yLabel = escapeHtml(graph.axes?.y?.label ?? 'y');
  container.classList.remove('empty-state');
  container.innerHTML = `<svg class="visual-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(graph.type)}"><path class="edge" d="M ${padding} ${height - padding} H ${width - padding} M ${padding} ${height - padding} V ${padding}"/>${series}<text x="${padding}" y="${height - 10}" class="edge-label">${escapeHtml(String(xRange.min))}</text><text x="${width - padding}" y="${height - 10}" class="edge-label">${escapeHtml(String(xRange.max))}</text><text x="${padding + 4}" y="${padding + 12}" class="edge-label">${escapeHtml(String(yRange.max))}</text><text x="${width - padding - 4}" y="${height - 8}" class="edge-label">${xLabel}</text><text x="${padding + 6}" y="${padding + 12}" class="edge-label">${yLabel}</text></svg>`;
}

function renderPlotly(container, graph, stepIndex) {
  const visibleCount = graph.states?.[Math.min(stepIndex, graph.states.length - 1)]?.pointCount ?? Infinity;
  const traces = graph.series.map((series) => {
    const points = (series.points ?? []).filter(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)).slice(0, visibleCount);
    return { x: points.map((point) => point.x), y: points.map((point) => point.y), type: 'scatter', mode: 'lines+markers', name: String(series.expression ?? 'series'), line: { color: '#c3f36b', width: 3 }, marker: { color: '#c3f36b', size: 5 } };
  });
  container.classList.remove('empty-state');
  globalThis.window.Plotly.react(container, traces, {
    margin: { l: 44, r: 10, t: 10, b: 36 }, height: 190,
    paper_bgcolor: '#111a20', plot_bgcolor: '#111a20', font: { color: '#aab8ae', size: 10 },
    xaxis: { title: graph.axes?.x?.label ?? 'x', gridcolor: '#304046', zerolinecolor: '#718084' },
    yaxis: { title: graph.axes?.y?.label ?? 'y', gridcolor: '#304046', zerolinecolor: '#718084' },
    showlegend: graph.series.length > 1
  }, { responsive: true, displayModeBar: false });
}

function format(value) { return escapeHtml(Number(value.toPrecision(3)).toString()); }

function renderEmpty(container) {
  container.classList.add('empty-state');
  container.innerHTML = '<div class="empty-orbit">b</div><p>No structured visual output was produced.</p>';
}

function range(minimum, maximum) {
  if (minimum === maximum) return { min: minimum - 1, max: maximum + 1 };
  return { min: minimum, max: maximum };
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
