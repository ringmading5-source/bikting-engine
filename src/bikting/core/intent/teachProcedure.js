/** Compile concept relationships into a bounded, inspectable teaching sequence. */
import { getActionDefinition, defaultActionRegistry } from './actionRegistry.js';

export function compileActionProcedure(semantic, registry = defaultActionRegistry) {
  const definition = getActionDefinition(semantic.intent, registry);
  if (!definition) throw new Error(`No relational action definition for ${semantic.intent}.`);
  const concept = semantic.concepts?.[0];
  const edges = (semantic.relationships ?? []).filter(({ from, relation, to }) => from && relation && to);
  if (!concept) return { status: 'blocked', action: definition.id, reason: definition.question, stages: [] };
  if (!edges.length) return { status: 'blocked', action: definition.id, reason: `I need relationships about ${label(concept)} before I can ${definition.id} it.`, stages: [] };

  const seen = new Set([concept]);
  const ordered = [];
  const request = semantic.context?.wordComposition ?? {};
  const beginner = semantic.context?.sentenceMeaning?.constraints?.some(({ kind, value }) => kind === 'audience_level' && value === 'beginner');
  const limit = request.modifiers?.includes('length') ? 2 : definition.maxRelationships;
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
  if (!ordered.length) return { status: 'blocked', action: definition.id, reason: `No supplied relationship connects to ${label(concept)}.`, stages: [] };
  return { status: 'ready', action: definition.id, concept, stages: [
    { id: 'overview', title: 'Start with the whole', text: `${request.recipient === 'me' ? 'You' : 'We'} will ${definition.introduction} ${label(concept)} and how its parts connect.${beginner ? ' We will start with the basic idea and introduce one relationship at a time.' : ''}`, relationships: [] },
    ...ordered.map((edge, index) => ({ id: `relationship-${index + 1}`, title: `${label(edge.from)} → ${label(edge.to)}`, text: `${label(edge.from)} ${label(edge.relation)} ${label(edge.to)}.`, relationships: [edge] })),
    ...(definition.closing === 'check' ? [{ id: 'check', title: 'Check understanding', text: `How does ${label(ordered[0].from)} relate to ${label(ordered[0].to)}?`, relationships: [ordered[0]] }] : []),
  ] };
}

export const compileTeachProcedure = compileActionProcedure;

function label(value) { return String(value).replaceAll('_', ' '); }
