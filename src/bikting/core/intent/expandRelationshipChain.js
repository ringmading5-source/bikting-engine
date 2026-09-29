/** Expand only relationships connected to the current teaching frontier. */
export async function expandRelationshipChain({ concept, relationships, propose, maxRounds = 2, maxEdges = 12 }) {
  const edges = [...relationships];
  const key = ({ from, relation, to }) => `${from}\0${relation}\0${to}`;
  const known = new Set(edges.map(key));
  const connected = new Set([concept]);
  let frontier = new Set([concept]);
  while (frontier.size) {
    const next = new Set();
    for (const edge of edges) if (frontier.has(edge.from) || frontier.has(edge.to)) {
      for (const node of [edge.from, edge.to]) if (!connected.has(node)) { connected.add(node); next.add(node); }
    }
    frontier = next;
  }
  if (connected.size === 1) return { relationships: edges, rounds: [], stopReason: 'no_connected_start' };
  const outgoing = new Set(edges.filter(({ from }) => connected.has(from)).map(({ from }) => from));
  frontier = new Set([...connected].filter((node) => node !== concept && !outgoing.has(node)));
  if (!frontier.size) return { relationships: edges, rounds: [], stopReason: 'no_open_frontier' };
  const rounds = [];
  for (let round = 0; round < maxRounds && edges.length < maxEdges; round++) {
    const candidates = await propose({ concept, frontier: [...frontier], relationships: edges.slice(0, maxEdges), round: round + 1 });
    const accepted = [];
    const next = new Set();
    for (const edge of candidates ?? []) {
      if (edges.length >= maxEdges) break;
      if (!edge?.from || !edge?.to || edge.from === edge.to || !frontier.has(edge.from) && !frontier.has(edge.to) || known.has(key(edge))) continue;
      const newNodes = [edge.from, edge.to].filter((node) => !connected.has(node));
      if (!newNodes.length) continue;
      known.add(key(edge)); edges.push(edge); accepted.push(edge);
      for (const node of newNodes) { connected.add(node); next.add(node); }
    }
    rounds.push({ round: round + 1, from: [...frontier], accepted });
    if (!accepted.length) return { relationships: edges, rounds, stopReason: 'no_coherent_new_relationship' };
    frontier = next;
  }
  return { relationships: edges, rounds, stopReason: edges.length >= maxEdges ? 'edge_budget' : 'round_budget' };
}
