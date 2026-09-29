import { actionForWord } from './actionVocabulary.js';

const capabilities = Object.freeze({ summarize: 'text.summarize', compare: 'text.compare', find: 'research.search', edit: 'artifact.edit', check: 'claim.verify' });
const questions = Object.freeze({ summarize: 'Paste the material you want summarized.', compare: 'Name both things and the criteria you want compared.', find: 'What should I search for?', edit: 'Name the existing result and the change you want.', check: 'What claim and evidence should I check?' });

export function resolveWorkAction(text) {
  const match = /^\s*(?:(?:please|can you|could you|would you|i want you to)\s+)*(\p{L}+)\b\s*(.*)$/iu.exec(String(text));
  const action = actionForWord(match?.[1]);
  if (!capabilities[action]) return null;
  const input = match[2].trim().replace(/[?.!]+$/, '').trim();
  return { action, capability: capabilities[action], input, missing: input ? null : questions[action] };
}
