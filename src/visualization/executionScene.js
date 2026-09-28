/** Explain observable tool work as a visual sequence; never turn planned work into a completed result. */
export function createExecutionScene(result) {
  const operations = (result.execution ?? []).filter((item) => item.metadata?.kind === 'tool' || item.metadata?.kind === 'model');
  if (!operations.length) return null;
  const objects = []; const relationships = []; const states = [];
  for (const [index, item] of operations.entries()) {
    const input = `input_${index}`; const tool = `tool_${index}`; const output = `output_${index}`;
    const toolName = item.metadata?.adapterId ?? 'unknown tool';
    const status = item.status ?? 'unknown';
    const resultText = describe(item);
    objects.push({ id: input, label: truncate(result.context?.metadata?.requestText ?? 'Request') }, { id: tool, label: truncate(toolName) }, { id: output, label: truncate(resultText) });
    relationships.push({ from: input, relation: 'uses', to: tool }, { from: tool, relation: status === 'completed' ? 'produces' : 'status', to: output });
    states.push({ activeNodes: [input], activeEdge: index * 2, title: 'Input', text: `Request: ${result.context?.metadata?.requestText ?? 'User input'}` });
    states.push({ activeNodes: [tool], activeEdge: index * 2, title: 'Selected tool', text: `${toolName} (${item.metadata?.capability ?? 'operation'}).` });
    states.push({ activeNodes: [output], activeEdge: index * 2 + 1, title: status === 'completed' ? 'Observed result' : 'Execution status', text: `${status}: ${resultText}${/[.!?]$/.test(resultText) ? '' : '.'}` });
  }
  return { type: 'diagram', objects, relationships, states, toolSelection: { selected: { id: 'bikting.execution-flow', name: 'Bikting Execution Flow', status: 'available' }, recommended: null, requestedArtifact: 'execution_trace' }, source: { type: 'engine', id: 'execution-visualizer' } };
}

function describe(item) {
  if (item.status !== 'completed') return item.error ?? item.message ?? 'Not executed';
  if (Number.isFinite(item.numericResult)) return `${item.numericResult}${item.to?.unit ? ` ${item.to.unit}` : ''}`;
  if (typeof item.text === 'string') return item.text;
  if (item.structuredVisualScenes) return 'Structured visual result';
  return item.type ?? 'Completed';
}
function truncate(value) { const text = String(value); return text.length > 26 ? `${text.slice(0, 23)}…` : text; }
