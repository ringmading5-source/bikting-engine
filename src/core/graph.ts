import { Entity, EntityId, Relationship } from "./types";

/** In-memory directed relationship graph for Bikting entities. */
export class BiktingGraph {
  private entities = new Map<EntityId, Entity>();
  private relationships = new Map<string, Relationship>();
  private sealed = false;

  addEntity(entity: Entity): void {
    this.assertMutable();
    this.entities.set(entity.id, entity);
  }

  getEntity(id: EntityId): Entity | undefined {
    return this.entities.get(id);
  }

  addRelationship(relationship: Relationship): void {
    this.assertMutable();
    if (!this.entities.has(relationship.from) || !this.entities.has(relationship.to)) {
      throw new Error(`Relationship references unknown entity: ${relationship.id}`);
    }

    this.relationships.set(relationship.id, relationship);
  }

  getRelationship(id: string): Relationship | undefined {
    return this.relationships.get(id);
  }

  getOutgoing(entityId: EntityId): Relationship[] {
    return [...this.relationships.values()].filter((relationship) => relationship.from === entityId);
  }

  getIncoming(entityId: EntityId): Relationship[] {
    return [...this.relationships.values()].filter((relationship) => relationship.to === entityId);
  }

  findRelated(entityId: EntityId, relationshipType?: string): Entity[] {
    return this.getOutgoing(entityId)
      .filter((relationship) => !relationshipType || relationship.type === relationshipType)
      .map((relationship) => this.entities.get(relationship.to))
      .filter((entity): entity is Entity => entity !== undefined);
  }

  getAllEntities(): Entity[] {
    return [...this.entities.values()];
  }

  getAllRelationships(): Relationship[] {
    return [...this.relationships.values()];
  }

  /** Prevent further mutation once a graph becomes part of compiled context. */
  seal(): this {
    this.sealed = true;
    return this;
  }

  isSealed(): boolean { return this.sealed; }

  private assertMutable(): void {
    if (this.sealed) throw new Error("BiktingGraph is sealed and cannot be mutated.");
  }
}
