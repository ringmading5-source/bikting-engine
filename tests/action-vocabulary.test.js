import test from 'node:test';
import assert from 'node:assert/strict';
import { actionForWord } from '../src/bikting/core/intent/actionVocabulary.js';
import { createBiktingRuntime } from '../src/runtime/BiktingRuntime.js';

test('action synonyms map to one family without enumerating subject concepts', async () => {
  assert.equal(actionForWord('CREATE'), 'build');
  assert.equal(actionForWord('tutor'), 'teach');
  assert.equal(actionForWord('compute'), 'calculate');
  assert.equal(actionForWord('photosynthesis'), null);
  const runtime = createBiktingRuntime();
  const website = await runtime.run({ text: 'Create a website for my class' });
  assert.equal(website.semantic.context.task.capability, 'website.build');
  const teaching = await runtime.run({ text: 'Tutor me about photosynthesis' });
  assert.equal(teaching.semantic.intent, 'teach');
  assert.ok(teaching.semantic.concepts.includes('photosynthesis'));
  assert.equal(teaching.workspace.wordComposition.words[0].role, 'action');
});
