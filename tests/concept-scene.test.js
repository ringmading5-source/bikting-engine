import test from 'node:test';
import assert from 'node:assert/strict';
import { createConceptPieceScene } from '../src/visualization/conceptScene.js';

test('biological cell relationships become connected visual pieces with progressive states', () => {
  const scene = createConceptPieceScene({ semantic: {
    concepts: ['cell'], entities: [
      { id: 'cell', label: 'Cell' }, { id: 'cell_membrane', label: 'Cell membrane' },
      { id: 'cytoplasm', label: 'Cytoplasm' }, { id: 'nucleus', label: 'Nucleus' },
    ], relationships: [
      { from: 'cell', relation: 'contains', to: 'cytoplasm' },
      { from: 'cell', relation: 'contains', to: 'nucleus' },
    ], context: { domain: 'biology' }
  } });
  assert.equal(scene.type, 'concept-pieces');
  assert.equal(scene.pieces.find((piece) => piece.id === 'cell').role, 'container');
  assert.equal(scene.pieces.find((piece) => piece.id === 'nucleus').role, 'core');
  assert.equal(scene.states.length, 4);
  assert.ok(scene.states.some(({ text }) => text.includes('Nucleus')));
});

test('concept renderer refuses a relationship-free semantic object', () => {
  assert.equal(createConceptPieceScene({ semantic: { entities: [{ id: 'cell', label: 'Cell' }], relationships: [] } }), null);
});
