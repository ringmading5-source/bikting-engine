/** @typedef {'text'|'voice'|'vision'|'api'|'workspace'|'unknown'} Modality */
/**
 * @typedef {'explicit'|'inferred'|'knowledge'} SemanticAssertionOrigin
 * @typedef {{source:string, method?:string, detail?:string}} SemanticProvenance
 * @typedef {{concept:string, origin:SemanticAssertionOrigin, confidence:number, provenance:SemanticProvenance[]}} SemanticConceptEvidence
 * @typedef {{from:string, relation:string, to:string, origin?:SemanticAssertionOrigin, confidence?:number, provenance?:SemanticProvenance[], metadata?:Record<string, unknown>}} SemanticRelationship
 * @typedef {{id:string, label:string, type?:string, metadata?:Record<string, unknown>}} SemanticEntity
 * @typedef {Object} BiktingSemanticObject
 * @property {string} id
 * @property {string} source
 * @property {Modality} modality
 * @property {string} intent
 * @property {SemanticEntity[]} entities
 * @property {string[]} concepts
 * @property {SemanticConceptEvidence[]} conceptEvidence
 * @property {SemanticRelationship[]} relationships
 * @property {SemanticRelationship[]} knowledgeRelationships
 * @property {{explicit:{concepts:SemanticConceptEvidence[],relationships:SemanticRelationship[]},inferred:{concepts:SemanticConceptEvidence[],relationships:SemanticRelationship[]},knowledge:{concepts:SemanticConceptEvidence[],relationships:SemanticRelationship[]}}} assertions
 * @property {Array<{id:string,type:string,description?:string,metadata?:Record<string,unknown>}>} actions
 * @property {Record<string,unknown>} context
 * @property {Record<string,unknown>} state
 * @property {Record<string,number|string|number[]>} variables
 * @property {string[]} equations
 * @property {string[]} goals
 * @property {string[]} constraints
 * @property {string[]} requestedOutputs
 * @property {Array<{source:string,method?:string,detail?:string}>} provenance
 * @property {number} confidence
 * @property {{createdAt:string,updatedAt:string}} timestamps
 */

/** Create a validated, extensible semantic object with safe collection defaults. */
export function createSemanticObject(input = {}) {
  const now = new Date().toISOString();
  const object = {
    id: input.id ?? globalThis.crypto?.randomUUID?.() ?? `semantic-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    source: input.source ?? 'user',
    modality: input.modality ?? 'unknown',
    intent: input.intent ?? 'unknown',
    entities: [...(input.entities ?? [])], concepts: [...(input.concepts ?? [])], conceptEvidence: [...(input.conceptEvidence ?? [])],
    relationships: [...(input.relationships ?? [])], knowledgeRelationships: [...(input.knowledgeRelationships ?? [])], actions: [...(input.actions ?? [])],
    context: { ...(input.context ?? {}) }, state: { ...(input.state ?? {}) },
    variables: { ...(input.variables ?? {}) }, equations: [...(input.equations ?? [])],
    goals: [...(input.goals ?? [])], constraints: [...(input.constraints ?? [])],
    requestedOutputs: [...(input.requestedOutputs ?? [])], provenance: [...(input.provenance ?? [])],
    confidence: input.confidence ?? 0,
    timestamps: { createdAt: input.timestamps?.createdAt ?? now, updatedAt: now },
  };
  if (typeof object.intent !== 'string' || typeof object.source !== 'string') throw new TypeError('Semantic source and intent must be strings.');
  if (!Number.isFinite(object.confidence) || object.confidence < 0 || object.confidence > 1) throw new RangeError('Confidence must be between 0 and 1.');
  return synchronizeSemanticAssertions(object);
}

export function addEntity(semantic, entity) {
  const normalized = typeof entity === 'string' ? { id: slug(entity), label: entity } : { ...entity };
  if (!normalized.id || !normalized.label) throw new TypeError('An entity needs an id and label.');
  if (!semantic.entities.some((item) => item.id === normalized.id)) semantic.entities.push(normalized);
  semantic.timestamps.updatedAt = new Date().toISOString();
  return normalized;
}

export function addRelationship(semantic, relationship, relationshipTypes) {
  relationshipTypes.assert(relationship.relation);
  if (!relationship.from || !relationship.to) throw new TypeError('A relationship needs from and to entity ids.');
  const normalized = { ...relationship };
  semantic.relationships.push(normalized);
  synchronizeSemanticAssertions(semantic);
  semantic.timestamps.updatedAt = new Date().toISOString();
  return normalized;
}

/** Keep request statements distinct from inferred and future knowledge assertions. */
export function synchronizeSemanticAssertions(semantic) {
  const categorize = (items, property) => ({
    explicit: items.filter((item) => (item[property] ?? 'inferred') === 'explicit'),
    inferred: items.filter((item) => (item[property] ?? 'inferred') === 'inferred'),
    knowledge: items.filter((item) => item[property] === 'knowledge'),
  });
  const concepts = categorize(semantic.conceptEvidence ?? [], 'origin');
  const relationships = categorize(semantic.relationships ?? [], 'origin');
  semantic.assertions = {
    explicit: { concepts: concepts.explicit, relationships: relationships.explicit },
    inferred: { concepts: concepts.inferred, relationships: relationships.inferred },
    knowledge: { concepts: concepts.knowledge, relationships: [...relationships.knowledge, ...(semantic.knowledgeRelationships ?? [])] },
  };
  return semantic;
}

function slug(value) { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }
