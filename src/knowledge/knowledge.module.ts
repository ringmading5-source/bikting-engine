import { BiktingGraph } from "../core/graph";
import { Registry } from "../core/registry";
import { KnowledgeModule } from "./knowledge.types";

/** Loads content modules into a graph without embedding domain data in the engine. */
export class KnowledgeRegistry extends Registry<KnowledgeModule> {
  registerModule(module: KnowledgeModule, graph?: BiktingGraph): KnowledgeModule {
    this.validate(module);
    const registered = this.register(module);
    if (graph) {
      for (const concept of module.concepts) graph.addEntity(concept);
      for (const relationship of module.relationships) graph.addRelationship(relationship);
    }
    return registered;
  }

  private validate(module: KnowledgeModule): void {
    const conceptIds = new Set(module.concepts.map((concept) => concept.id));
    for (const relationship of module.relationships) {
      if (!conceptIds.has(relationship.from) || !conceptIds.has(relationship.to)) {
        throw new Error(`Knowledge relationship references a concept outside ${module.id}: ${relationship.id}`);
      }
    }
  }
}
