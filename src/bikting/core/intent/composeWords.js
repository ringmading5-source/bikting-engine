/** Preserve each word's role in the request before action planning. */
import { getActionDefinition, defaultActionRegistry } from './actionRegistry.js';
export function composeWords(text, semantic = {}, registry = defaultActionRegistry) {
  const words = [...String(text).matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu)]
    .slice(0, 80).map(([surface], index) => ({ index, surface, normalized: surface.toLowerCase(), role: 'context' }));
  const action = String(semantic.intent ?? 'unknown').split('_')[0];
  const verbs = { explain: ['explain'], build: ['build', 'make', 'create', 'design'], deploy: ['deploy', 'publish'] };
  const trigger = words.find((word) => (getActionDefinition(action, registry)?.verbs ?? verbs[action])?.includes(word.normalized));
  if (trigger) trigger.role = 'action';
  const recipient = words.find((word) => ['me', 'us'].includes(word.normalized) && word.index > (trigger?.index ?? -1));
  if (recipient && trigger) recipient.role = 'recipient';
  const target = semantic.concepts?.[0];
  const targetParts = String(target ?? '').toLowerCase().split(/[_\s]+/).filter(Boolean);
  if (trigger && targetParts.length) {
    for (const word of words) if (word.index > trigger.index && targetParts.some((part) => sameForm(word.normalized, part))) word.role = 'target';
  }
  const modifiers = { visually: 'visual', visual: 'visual', aloud: 'voice', slowly: 'pace', briefly: 'length', deeply: 'depth' };
  for (const word of words) if (modifiers[word.normalized] && word.role === 'context') word.role = 'modifier';
  const grammar = { about: 'topic_link', of: 'topic_link', how: 'method_link', with: 'method_link', for: 'purpose_link', to: 'direction_link', and: 'conjunction', the: 'determiner', a: 'determiner', an: 'determiner', my: 'possessor', our: 'possessor', please: 'politeness' };
  for (const word of words) if (grammar[word.normalized] && word.role === 'context') word.role = grammar[word.normalized];
  const relations = words.filter((word) => word.role !== 'context' && word !== trigger)
    .map((word) => ({ from: trigger?.index, relation: word.role, to: word.index }));
  return { words, relations, action: trigger?.normalized ?? null, target: words.filter((word) => word.role === 'target').map((word) => word.surface).join(' ') || null,
    recipient: recipient?.normalized ?? null, modifiers: words.filter((word) => word.role === 'modifier').map((word) => modifiers[word.normalized]) };
}

function sameForm(word, concept) {
  if (word === concept) return true;
  return word.endsWith('ies') && `${word.slice(0, -3)}y` === concept || word.endsWith('s') && word.slice(0, -1) === concept;
}
