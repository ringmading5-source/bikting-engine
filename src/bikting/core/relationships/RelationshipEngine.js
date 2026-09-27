import { addRelationship, synchronizeSemanticAssertions } from '../types/semantic.js';
import { relationshipTypes as defaultTypes } from './RelationshipTypeRegistry.js';

export class RelationshipEngine {
  constructor(types = defaultTypes) { this.types = types; }
  add(semantic, relationship) { return addRelationship(semantic, relationship, this.types); }
  updateState(semantic) {
    synchronizeSemanticAssertions(semantic);
    semantic.state.relationshipCount = semantic.relationships.length;
    semantic.state.entityCount = semantic.entities.length;
    semantic.state.relationshipTypes = [...new Set(semantic.relationships.map(({ relation }) => relation))];
    semantic.state.explicitRelationshipCount = semantic.assertions.explicit.relationships.length;
    semantic.state.inferredRelationshipCount = semantic.assertions.inferred.relationships.length;
    semantic.state.knowledgeRelationshipCount = semantic.assertions.knowledge.relationships.length;
    return semantic.state;
  }
  graph(semantic) {
    return {
      entities: semantic.entities,
      relationships: semantic.relationships,
      knowledgeRelationships: semantic.knowledgeRelationships ?? [],
      assertions: semantic.assertions,
    };
  }
}
