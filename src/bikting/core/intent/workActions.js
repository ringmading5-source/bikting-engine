import { actionForWord } from './actionVocabulary.js';

const capabilities = Object.freeze({ summarize: 'text.summarize', compare: 'text.compare', find: 'research.search', edit: 'artifact.edit', check: 'claim.verify' });
const questions = Object.freeze({ summarize: 'Paste the material you want summarized.', compare: 'Name both things and the criteria you want compared.', find: 'What should I search for?', edit: 'Name the existing result and the change you want.', check: 'What claim and evidence should I check?' });

export function resolveWorkAction(text, projectContext = null) {
  const match = /^\s*(?:(?:please|can you|could you|would you|i want you to)\s+)*(\p{L}+)\b\s*(.*)$/iu.exec(String(text));
  const action = actionForWord(match?.[1]);
  if (!capabilities[action]) return null;
  const input = match[2].trim().replace(/[?.!]+$/, '').trim();
  const websiteEdit = action === 'edit' && /\b(website|site|page|it|its|this|that)\b/i.test(input);
  const linked = websiteEdit && projectContext?.type === 'website' && typeof projectContext.html === 'string';
  return { action, capability: linked ? 'website.edit' : capabilities[action], input,
    missing: !input ? questions[action] : websiteEdit && !linked ? 'Which website should I change? Open its preview and try again.' : null };
}
