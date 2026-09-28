import { selectVisualTool } from './visualToolCatalog.js';

const actions = new Set(['highlight', 'flow', 'pulse']);

/** Compile a small prompt from verified relationship IDs and the renderer that can actually run. */
export function compileBehaviorPrompt({ domain, artifact, relationships }) {
  const selection = selectVisualTool({ domain, artifact });
  return {
    selection,
    text: JSON.stringify({
      task: 'Propose visual behavior instructions as JSON. Use only the listed relationships, in a meaningful teaching order. Each step must reference one exact from/relation/to triple. Actions: highlight, flow, pulse. A flow animates movement along the relationship; a pulse emphasizes an effect; highlight focuses both concepts. Write one concise narration sentence per step. Do not invent objects, facts, code, formulas, physics, or unavailable renderer operations.',
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
