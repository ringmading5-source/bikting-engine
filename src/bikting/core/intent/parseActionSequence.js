import { actionForWord } from './actionVocabulary.js';

/** Resolve commands, not incidental mentions of action words in a target. */
export function parseActionSequence(input) {
  const text = String(input ?? '').trim();
  if (!text) return { status: 'empty', actions: [] };
  const clauses = text.split(/\s*[,;]?\s+\b(?:and\s+)?then\b\s*[,;]?\s*/i).map((part) => part.trim()).filter(Boolean);
  const actions = clauses.map((clause, index) => {
    const command = clause.replace(/^(?:(?:please|can you|could you|would you|i want you to)\s+)+/i, '').trim();
    const match = /^(?:(do not|don't|never|not)\s+)?([\p{L}]+)\b/iu.exec(command);
    const family = actionForWord(match?.[2] ?? '');
    const target = match ? command.slice(match[0].length).trim() : '';
    return { order: index + 1, text: clause, verb: match?.[2]?.toLowerCase() ?? null, family, target, negated: Boolean(match?.[1]) };
  });
  if (actions.some((action) => action.negated && action.family)) return { status: 'negated', actions };
  if (clauses.length > 5 || clauses.length > 1 && actions.some((action) => !action.family || /^(?:it|this|that|them)\b/i.test(action.target))) return { status: 'unresolved', actions };
  return { status: 'ready', actions };
}
