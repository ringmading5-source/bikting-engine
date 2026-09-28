import { selectVisualTool } from './visualToolCatalog.js';

const actions = new Set(['highlight', 'flow', 'pulse']);

/** Execute relationship semantics with the browser renderer, without a model call. */
export function programFromRelationships(relationships) {
  return { language: 'bikting-visual-v1', steps: relationships.map(({ from, relation, to }) => ({
    from, relation, to,
    action: /flow|transfer|move|transform/.test(relation) ? 'flow' : /cause|produce|activate|increase|decrease/.test(relation) ? 'pulse' : 'highlight',
    narration: `${label(from)} ${relation.replaceAll('_', ' ')} ${label(to)}.`
  })) };
}

function label(value) { return String(value).replaceAll('_', ' '); }

/** Compile a small prompt from verified relationship IDs and the renderer that can actually run. */
export function compileBehaviorPrompt({ domain, artifact, relationships }) {
  const selection = selectVisualTool({ domain, artifact });
  return {
    selection,
    text: JSON.stringify({
      task: 'Relationship behavior contract for a visualization tool. Use only the listed relationships, in teaching order. Each step references one exact from/relation/to triple. Actions: highlight, flow, pulse. Flow animates movement; pulse emphasizes an effect; highlight focuses both concepts. The engine executes these behaviors directly. Do not invent objects, facts, formulas, physics, or unavailable renderer operations.',
      domain, requestedArtifact: artifact, executableRenderer: selection.selected.id,
      relationships: relationships.map(({ from, relation, to }) => ({ from, relation, to }))
    })
  };
}

/** A model response is a proposal. Accept only actions grounded in the relationship model. */
export function validateVisualProgram(proposal, relationships) {
  if (!Array.isArray(proposal?.steps)) throw new TypeError('Visual program needs steps.');
  const keys = new Set(relationships.map(({ from, relation, to }) => `${from}\0${relation}\0${to}`));
  const seen = new Set();
  const steps = [];
  for (const item of proposal.steps.slice(0, 16)) {
    const key = `${item?.from}\0${item?.relation}\0${item?.to}`;
    if (!keys.has(key) || seen.has(key) || !actions.has(item.action)) continue;
    const narration = typeof item.narration === 'string' ? item.narration.trim().slice(0, 220) : '';
    if (!narration) continue;
    seen.add(key);
    steps.push({ from: item.from, relation: item.relation, to: item.to, action: item.action, narration });
  }
  if (!steps.length) throw new Error('Visual program contains no supported relationship actions.');
  return { language: 'bikting-visual-v1', steps };
}
