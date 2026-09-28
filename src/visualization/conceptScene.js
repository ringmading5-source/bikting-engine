/** Build deterministic concept pieces from validated semantic entities and relationships. */
export function createConceptPieceScene(result) {
  const semantic = result?.semantic ?? result ?? {};
  const entities = Array.isArray(semantic.entities) ? semantic.entities.slice(0, 16) : [];
  const relationships = Array.isArray(semantic.relationships) ? semantic.relationships.slice(0, 24) : [];
  if (!entities.length || !relationships.length) return null;
  const topic = String(semantic.concepts?.[0] ?? semantic.context?.domain ?? 'concept').replaceAll('_', ' ');
  const isCell = entities.some(({ id, label }) => /\bcell\b/i.test(`${id} ${label}`));
  const domain = String(semantic.context?.domain ?? '').toLowerCase();
  if (!isCell && domain !== 'biology' && semantic.context?.visualArtifact !== 'concept_pieces') return null;
  const pieces = entities.map((entity, index) => pieceFor(entity, index, entities.length, isCell));
  const states = pieces.map((piece, index) => ({
    activeNodes: [piece.id],
    activeEdge: Math.max(0, relationships.findIndex(({ from, to }) => from === piece.id || to === piece.id)),
    action: piece.role === 'container' ? 'contain' : 'highlight',
    title: piece.title,
    text: piece.description,
  }));
  return {
    type: 'concept-pieces',
    topic,
    pieces,
    objects: pieces.map(({ id, label, role }) => ({ id, label, role })),
    relationships,
    states,
    source: { type: 'engine', id: 'concept-piece-renderer' },
    toolSelection: { selected: { id: 'bikting.concept-pieces', name: 'Bikting Concept Pieces', status: 'available' }, recommended: null, requestedArtifact: 'concept_pieces' },
  };
}

function pieceFor(entity, index, total, isCell) {
  const id = String(entity.id ?? `concept_${index}`);
  const label = String(entity.label ?? id).replaceAll('_', ' ');
  const lower = `${id} ${label}`.toLowerCase();
  const role = isCell ? cellRole(lower) : genericRole(lower);
  const position = isCell ? cellPosition(role, index, total) : genericPosition(index, total);
  return {
    id, label, role, x: position.x, y: position.y, width: position.width, height: position.height,
    title: `${label[0]?.toUpperCase() ?? ''}${label.slice(1)} piece`,
    description: role === 'container' ? `${label} contains the connected parts.` : `${label} is connected to the concept through the relationships shown.`,
  };
}

function cellRole(value) {
  if (/membrane|wall|cell\b/.test(value)) return 'container';
  if (/nucleus|dna|chromosome/.test(value)) return 'core';
  if (/mitochond|chloroplast|vacuole|organelle/.test(value)) return 'organelle';
  if (/water|oxygen|carbon|glucose|energy|nutrient|substance/.test(value)) return 'flow';
  return 'part';
}
function genericRole(value) { if (/system|cell|body|whole|container/.test(value)) return 'container'; if (/cause|force|energy|core|main/.test(value)) return 'core'; return 'part'; }
function cellPosition(role, index, total) {
  if (role === 'container') return { x: 350, y: 140, width: 560, height: 210 };
  if (role === 'core') return { x: 350, y: 140, width: 110, height: 110 };
  const side = index % 2 === 0 ? -1 : 1;
  return { x: 350 + side * (110 + (Math.floor(index / 2) % 2) * 75), y: 80 + (Math.floor(index / 4) % 3) * 62, width: role === 'flow' ? 94 : 118, height: role === 'flow' ? 42 : 54 };
}
function genericPosition(index, total) { const columns = Math.min(4, Math.max(1, total)); return { x: 90 + (index % columns) * (520 / Math.max(1, columns - 1)), y: 80 + Math.floor(index / columns) * 90, width: 124, height: 54 }; }
