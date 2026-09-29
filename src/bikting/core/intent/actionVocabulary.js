/** Supported action words map to behavior families; subject concepts are data. */
export const actionVocabulary = Object.freeze({
  teach: ['teach', 'tutor', 'instruct'],
  explore: ['explore', 'investigate'],
  explain: ['explain', 'describe'],
  build: ['build', 'create', 'make', 'design'],
  deploy: ['deploy', 'publish'],
  analyze: ['analyze', 'analyse'],
  calculate: ['calculate', 'compute', 'solve'],
  plot: ['plot', 'graph'],
  convert: ['convert'],
  summarize: ['summarize', 'summarise', 'condense', 'recap'],
  compare: ['compare', 'contrast'],
  find: ['find', 'search'],
  edit: ['edit', 'revise', 'change'],
  check: ['check', 'verify', 'review'],
});

export function actionForWord(word) {
  const normalized = String(word).toLowerCase();
  return Object.entries(actionVocabulary).find(([, variants]) => variants.includes(normalized))?.[0] ?? null;
}

export function wordsForAction(action) { return actionVocabulary[action] ?? []; }
