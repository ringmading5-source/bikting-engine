import test from 'node:test';
import assert from 'node:assert/strict';
import { previewIntent, runWebsiteFromIntent } from '../src/runtime/canonical-preview';

test('coding request executes its validated canonical plan and returns linked source files', async () => {
  const text = 'Build for me my personal website';
  const preview = await previewIntent(text);
  assert.equal(preview.plan?.steps[0].capabilityId, 'code.scaffold');
  assert.equal(preview.stepReadiness[0].state, 'ready_for_review');
  const generated = await runWebsiteFromIntent(text, preview.plan?.id);
  assert.equal(generated.planId, preview.plan?.id);
  assert.equal(generated.validated, true);
  assert.deepEqual(Object.keys(generated.files).sort(), ['index.html', 'script.js', 'styles.css']);
  assert.match(generated.files['index.html'], /href="styles.css"/);
  assert.match(generated.files['index.html'], /src="script.js"/);
});

test('coding endpoint rejects changed plans and arbitrary coding requests', async () => {
  await assert.rejects(runWebsiteFromIntent('Build for me my personal website', 'other-plan'), /plan changed/i);
  await assert.rejects(runWebsiteFromIntent('Execute this JavaScript', 'other-plan'), /personal website request only/);
});
