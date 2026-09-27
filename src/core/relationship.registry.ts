import { ProvenanceRecord } from "./types";

export interface RelationshipTypeDefinition {
  id: string;
  description?: string;
  metadata?: Record<string, unknown>;
  provenance?: ProvenanceRecord[];
}

/** Canonical vocabulary for relationship types used by knowledge and BIL compilation. */
export class RelationshipTypeRegistry {
  private readonly types = new Map<string, RelationshipTypeDefinition>();

  register(definition: RelationshipTypeDefinition | string): RelationshipTypeDefinition {
    const normalized = typeof definition === "string" ? { id: definition } : defensiveCopy(definition);
    if (!/^[a-z][a-z0-9_]*$/.test(normalized.id)) throw new TypeError("Relationship type must be a lowercase identifier.");
    if (this.types.has(normalized.id)) throw new Error(`Relationship type already registered: ${normalized.id}`);
    const frozen = Object.freeze(normalized);
    this.types.set(frozen.id, frozen);
    return frozen;
  }

  get(id: string): RelationshipTypeDefinition | undefined { return this.types.get(id); }
  has(id: string): boolean { return this.types.has(id); }
  assert(id: string): RelationshipTypeDefinition {
    const definition = this.get(id);
    if (!definition) throw new Error(`Unknown relationship type: ${id}`);
    return definition;
  }
  list(): RelationshipTypeDefinition[] { return [...this.types.values()].sort((left, right) => left.id.localeCompare(right.id)); }
}

/** Vocabulary migrated from the active JavaScript relationship registry. */
export function createDefaultRelationshipTypeRegistry(): RelationshipTypeRegistry {
  const registry = new RelationshipTypeRegistry();
  ["causes", "connected_to", "contains", "depends_on", "determines", "enables", "flows_to", "follows", "interacts_with", "multiplied_by", "part_of", "precedes", "produces", "related_to", "requires", "similar_to", "transforms", "transforms_into", "uses", "varies_over"]
    .forEach((id) => registry.register({ id, provenance: [{ source: "bikting.active-relationship-vocabulary", evidence: "Migrated from src/bikting/core/relationships/RelationshipTypeRegistry.js" }] }));
  return registry;
}

function defensiveCopy(definition: RelationshipTypeDefinition): RelationshipTypeDefinition {
  return { ...definition, metadata: definition.metadata ? { ...definition.metadata } : undefined, provenance: definition.provenance?.map((item) => ({ ...item })) };
}
