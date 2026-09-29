import { mockSemanticInterpreter } from '../bikting/core/adapters/mockSemanticInterpreter.js';
export async function previewIntent(request, interpret, enabled) {
  if (/^cell[.!?]?$/i.test(request.text.trim())) return { status: 'clarification', relationships: [], scene: null, question: 'Which kind of cell do you mean?', choices: ['Explain a biological cell', 'Explain a battery cell', 'Explain a spreadsheet cell'] };
  const baseline = await mockSemanticInterpreter(request);
  // Website generation belongs after approval. Other interpretations are cached
  // by the shared interpreter so execution reuses the reviewed semantics.
  const semantic = baseline.context.task ? baseline : await interpret(request);
  if (semantic.intent === 'teach' && !semantic.concepts?.length) return { status: 'clarification', relationships: [], scene: null,
    question: 'What would you like me to teach?', choices: [], task: { action: 'teach', required: ['topic'] } };
  const relationships = semantic.relationships ?? [];
  const objects = semantic.entities ?? [];
  const scene = relationships.length ? { type: 'diagram', objects, relationships, states: relationships.map(({ from, relation, to }, index) => ({ activeNodes: [from, to], activeEdge: index, action: 'highlight', title: `${from} ${relation} ${to}`, text: `${from} ${relation.replaceAll('_', ' ')} ${to}.` })) } : null;
  const unknown = semantic.intent === 'unknown';
  return { status: unknown ? 'clarification' : 'ready', knowledge: semantic.context.knowledge ?? null, task: semantic.context.task ?? null, relationships, scene, question: unknown ? (enabled ? 'What would you like to understand or create about this topic?' : 'General topic interpretation needs Gemini configured on the server. You can still use supported calculations.') : null, choices: [], explanation: semantic.context.geminiExplanation ?? '', message: relationships.length ? 'Review these interpreted relationships before continuing.' : 'This request has no relationship diagram. Review the request before continuing.' };
}
