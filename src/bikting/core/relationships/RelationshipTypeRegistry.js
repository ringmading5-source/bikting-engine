const builtInTypes = ['contains', 'part_of', 'causes', 'depends_on', 'requires', 'produces', 'enables', 'uses', 'transforms', 'transforms_into', 'related_to', 'flows_to', 'connected_to', 'similar_to', 'precedes', 'follows', 'interacts_with', 'multiplied_by', 'varies_over', 'determines'];

export class RelationshipTypeRegistry {
  #types = new Map();
  constructor(types = builtInTypes) { for (const type of types) this.register(type); }
  register(type, metadata = {}) {
    if (!/^[a-z][a-z0-9_]*$/.test(type)) throw new TypeError('Relationship type must be a lowercase identifier.');
    this.#types.set(type, { id: type, ...metadata });
    return this.#types.get(type);
  }
  has(type) { return this.#types.has(type); }
  assert(type) { if (!this.has(type)) throw new Error(`Unknown relationship type: ${type}`); }
  list() { return [...this.#types.values()]; }
}

export const relationshipTypes = new RelationshipTypeRegistry();
