import test from 'node:test';
import assert from 'node:assert/strict';
import { compileBehaviorPrompt, validateVisualProgram } from '../src/visualization/behaviorPrompt.js';

test('relationship behavior prompt selects the executable renderer and exact edges', () => {
  const relationships = [{ from: 'current', relation: 'produces', to: 'magnetic_field' }];
  const compiled = compileBehaviorPrompt({ domain: 'physics', artifact: '3d_scene', relationships });
  const prompt = JSON.parse(compiled.text);
  assert.equal(prompt.executableRenderer, 'bikting.relationship-diagram');
  assert.equal(compiled.selection.recommended.id, 'threejs');
  assert.deepEqual(prompt.relationships, relationships);
});

test('visual program refuses invented edges and unregistered actions', () => {
  const edges = [{ from: 'current', relation: 'produces', to: 'field' }];
  const program = validateVisualProgram({ steps: [
    { from: 'current', relation: 'produces', to: 'field', action: 'flow', narration: 'Current produces a field.' },
    { from: 'field', relation: 'creates', to: 'free_energy', action: 'flow', narration: 'Free energy.' },
    { from: 'current', relation: 'produces', to: 'field', action: 'execute_js', narration: 'Run code.' }
  ] }, edges);
  assert.equal(program.language, 'bikting-visual-v1');
  assert.equal(program.steps.length, 1);
  assert.equal(program.steps[0].action, 'flow');
});
