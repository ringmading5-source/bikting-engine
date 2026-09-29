/** Compile concept relationships into a bounded, inspectable teaching sequence. */
export function compileTeachProcedure(semantic) {
  const concept = semantic.concepts?.[0];
  const edges = (semantic.relationships ?? []).filter(({ from, relation, to }) => from && relation && to);
  if (!concept) return { status: 'blocked', reason: 'Which concept should I teach?', stages: [] };
  if (!edges.length) return { status: 'blocked', reason: `I need relationships about ${label(concept)} before I can teach it.`, stages: [] };

  const seen = new Set([concept]);
  const ordered = [];
  const request = semantic.context?.wordComposition ?? {};
  const limit = request.modifiers?.includes('length') ? 2 : 12;
  let frontier = [concept];
  while (frontier.length && ordered.length < limit) {
    const next = [];
    for (const edge of edges) {
      if (ordered.includes(edge) || !frontier.includes(edge.from) && !frontier.includes(edge.to)) continue;
      ordered.push(edge);
      for (const node of [edge.from, edge.to]) if (!seen.has(node)) { seen.add(node); next.push(node); }
      if (ordered.length === limit) break;
    }
    frontier = next;
  }
  if (!ordered.length) return { status: 'blocked', reason: `No supplied relationship connects to ${label(concept)}.`, stages: [] };
  return { status: 'ready', concept, stages: [
    { id: 'overview', title: 'Start with the whole', text: `${request.recipient === 'me' ? 'You' : 'We'} will learn ${label(concept)} and how its parts connect.`, relationships: [] },
    ...ordered.map((edge, index) => ({ id: `relationship-${index + 1}`, title: `${label(edge.from)} → ${label(edge.to)}`, text: `${label(edge.from)} ${label(edge.relation)} ${label(edge.to)}.`, relationships: [edge] })),
    { id: 'check', title: 'Check understanding', text: `How does ${label(ordered[0].from)} relate to ${label(ordered[0].to)}?`, relationships: [ordered[0]] },
  ] };
}

function label(value) { return String(value).replaceAll('_', ' '); }
