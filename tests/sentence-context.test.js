import test from 'node:test';
import assert from 'node:assert/strict';
import { createBiktingRuntime } from '../src/runtime/BiktingRuntime.js';
import { sentenceMeaning } from '../src/bikting/core/intent/sentenceMeaning.js';
import { previewIntent } from '../src/server/intentPreview.js';
import { mockSemanticInterpreter } from '../src/bikting/core/adapters/mockSemanticInterpreter.js';

test('sentence frame distinguishes purpose, audience, and reference', () => {
  const purpose = sentenceMeaning('Build a website for teaching biology');
  assert.deepEqual(purpose.purpose, { activity: 'teaching', subject: 'biology' });
  assert.equal(purpose.reference, null);
  const level = sentenceMeaning("Teach cells as if I'm a beginner");
  assert.deepEqual(level.constraints, [{ kind: 'audience_level', value: 'beginner' }]);
  assert.equal(sentenceMeaning('Change its colors').reference.resolved, null);
  assert.equal(sentenceMeaning('Teach cells with animations', null, { language: 'en' }).presentation.motion, 'animated');
  assert.equal(sentenceMeaning('Cells', null, { language: 'sw' }).language, 'sw');
});

test('animation requests retain a required capability instead of claiming a diagram is animation', async () => {
  const result = await createBiktingRuntime({ interpret: async (request) => ({ intent: 'teach', concepts: ['cell'],
    relationships: [{ from: 'cell', relation: 'contains', to: 'nucleus' }], requestedOutputs: ['visual', 'animation'],
    context: { sentenceMeaning: sentenceMeaning(request.text) }, confidence: 0.9 }) }).run({ text: 'Teach cells with animation' });
  assert.equal(result.semantic.context.sentenceMeaning.presentation.motion, 'animated');
  assert.equal(result.plan.capabilities.includes('visual.animate'), true);
  assert.equal(result.status, 'partial');
  assert.ok(result.workspace.moments.some((moment) => /visual\.animate/.test(moment.display.text)));
});

test('a beginner constraint changes the teaching sequence', async () => {
  const interpret = async (request) => ({ intent: 'teach', concepts: ['cell'], relationships: [{ from: 'cell', relation: 'contains', to: 'nucleus' }],
    requestedOutputs: ['visual'], context: { sentenceMeaning: sentenceMeaning(request.text) }, confidence: 0.9 });
  const result = await createBiktingRuntime({ interpret }).run({ text: "Teach cells as if I'm a beginner" });
  assert.match(result.workspace.moments[0].display.text, /basic idea/);
});

test('a follow-up color edit uses the existing website and returns a new preview', async () => {
  const runtime = createBiktingRuntime();
  const built = await runtime.run({ text: 'Build a website for biology students' });
  const original = built.workspace.scene;
  const edited = await runtime.run({ text: 'Change its colors to blue', projectContext: { type: 'website', title: original.title, html: original.html } });
  assert.equal(edited.semantic.context.sentenceMeaning.reference.resolved.type, 'website');
  assert.equal(edited.plan.capabilities.includes('website.edit'), true);
  assert.equal(edited.status, 'completed');
  assert.match(edited.workspace.scene.html, /#2563eb/);
  assert.notEqual(edited.workspace.scene.html, original.html);
  assert.equal(edited.execution.find((item) => item.metadata?.capability === 'website.edit').verification.status, 'verified');
});

test('an unresolved reference asks for the website before editing', async () => {
  const preview = await previewIntent({ text: 'Change its colors to blue' }, mockSemanticInterpreter, false);
  assert.equal(preview.status, 'clarification');
  assert.match(preview.question, /Which website/);
});
