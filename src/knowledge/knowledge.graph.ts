import { BiktingGraph } from "../core/graph";
import { Entity } from "../core/types";
import { KnowledgeConcept, KnowledgeModule } from "./knowledge.types";

export function traverseKnowledge(graph: BiktingGraph, conceptId: string, relationshipType?: string): Entity[] {
  return graph.findRelated(conceptId, relationshipType);
}

export function orderedSequence(module: KnowledgeModule, sequenceId: string): Entity[] {
  const sequence = module.sequences?.find((item) => item.id === sequenceId);
  if (!sequence) throw new Error(`Unknown knowledge sequence: ${sequenceId}`);
  const concepts = new Map(module.concepts.map((concept) => [concept.id, concept]));
  return [...sequence.steps]
    .sort((left, right) => left.order - right.order)
    .map((step) => concepts.get(step.conceptId))
    .filter((concept): concept is KnowledgeConcept => concept !== undefined);
}
