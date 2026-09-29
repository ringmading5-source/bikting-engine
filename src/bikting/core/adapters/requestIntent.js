/** Resolve an explicit user action and its object before choosing a capability. */
import { actionForWord } from '../intent/actionVocabulary.js';
export function resolveActionRequest(text) {
  const match = /^\s*(?:(?:please|can you|could you|would you|i want you to)\s+)*(build|create|make|design|deploy|publish)\b\s+(?:(?:me|us|a|an|the|my)\s+)*([^,.!?]+)/i.exec(text);
  if (!match) return null;
  const action = actionForWord(match[1]);
  const phrase = match[2].trim();
  const website = /\b(website|web\s*site|landing page|homepage)\b/i.exec(phrase);
  const target = website ? 'website' : /\b(app|application)\b/i.test(phrase) ? 'application' : 'artifact';
  const capability = target === 'website' ? `website.${action}` : 'artifact.build';
  const subject = website ? /\b(?:website|web\s*site|landing page|homepage)\s+for\s+([^,.!?]+)/i.exec(phrase)?.[1]?.trim() : null;
  return { action, target, capability, title: subject?.slice(0, 80) || 'Your Website', kind: /\bportfolio\b/i.test(phrase) ? 'portfolio' : /\brestaurant\b/i.test(phrase) ? 'restaurant' : 'general' };
}
