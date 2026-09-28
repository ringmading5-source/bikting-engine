import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultIntentRules } from '../src/runtime/intent-router';
import { previewIntent, runWebsiteFromIntent } from '../src/runtime/canonical-preview';
import { runLocalCalculation } from '../src/runtime/local-calculation';

const scenarios: [string, string | null][] = [
  ['Calculate 125 * 48', 'math.calculate'], ['Compute 2 + 2', 'math.calculate'],
  ['Evaluate (12 + 3) / 5', 'math.calculate'], ['Calculate 3 × 7', 'math.calculate'],
  ['Calculate 5 kilometers in meters', null], ['Run arbitrary JavaScript', null],
  ['Build for me my personal website', 'code.scaffold'], ['Create my personal website', 'code.scaffold'],
  ['Make my personal website!', 'code.scaffold'], ['Build a business dashboard', null],
  ['Generate an Android app', null], ['Create my personal website and publish it', null],
  ['Teach me cells in biology', 'knowledge.public_search'], ['Explain photosynthesis', 'knowledge.public_search'],
  ['What is magnesium?', 'knowledge.public_search'], ['Learn about statistics', 'knowledge.public_search'],
  ['Compare cells and tissues', null], ['Research current SSP exchange rates', null],
  ['Summarize my private documents', null], ['Send an email to everyone', null],
  ['Delete all files', null], ['', null],
];

test('agent-style prompt matrix routes only supported work', () => {
  const router = createDefaultIntentRules();
  for (const [prompt, expected] of scenarios) {
    if (!prompt) { assert.throws(() => router.resolve(prompt), /request/); continue; }
    assert.equal(router.resolve(prompt)?.capabilityId ?? null, expected, `Unexpected routing for: ${prompt}`);
  }
});

test('agent journey from paraphrased website intent to guarded generated files', async () => {
  const prompt = 'Create my personal website';
  const route = createDefaultIntentRules().resolve(prompt);
  const preview = await previewIntent(prompt);
  assert.equal(route?.capabilityId, preview.plan?.steps[0].capabilityId);
  const generated = await runWebsiteFromIntent(prompt, preview.plan?.id);
  assert.equal(generated.validated, true);
  assert.equal(generated.files['index.html'].includes('styles.css'), true);
});

test('agent journey from paraphrased arithmetic intent to verified local result', async () => {
  const route = createDefaultIntentRules().resolve('Compute (12 + 3) / 5');
  assert.equal(route?.capabilityId, 'math.calculate');
  const result = await runLocalCalculation(route?.inputs.expression);
  assert.equal(result.value, 3);
  assert.equal(result.verified, true);
});
