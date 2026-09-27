import { KnowledgeModule } from "./knowledge.types";
import { KnowledgeArtifact, KnowledgeRetrievalRequest, StaticKnowledgePayload } from "./knowledge-source.types";

export interface KnowledgeRetrievalAdapter { sourceId: string; retrieve(request: KnowledgeRetrievalRequest): Promise<KnowledgeArtifact[]>; }
export class KnowledgeRetriever {
  private readonly adapters = new Map<string, KnowledgeRetrievalAdapter>();
  register(adapter: KnowledgeRetrievalAdapter): void { if (this.adapters.has(adapter.sourceId)) throw new Error(`Knowledge retriever already registered: ${adapter.sourceId}`); this.adapters.set(adapter.sourceId, adapter); }
  has(sourceId: string): boolean { return this.adapters.has(sourceId); }
  async retrieve(request: KnowledgeRetrievalRequest): Promise<KnowledgeArtifact[]> { if (request.source.retrievalKind === "future_remote") throw new Error("Remote knowledge retrieval is disabled."); const adapter = this.adapters.get(request.source.id); if (!adapter) throw new Error(`No local knowledge retriever is registered for ${request.source.id}.`); const artifacts = await adapter.retrieve(structuredClone(request)); return deepFreeze(structuredClone(artifacts)); }
}

export class StaticStructuredKnowledgeAdapter implements KnowledgeRetrievalAdapter {
  private readonly payload: StaticKnowledgePayload;
  constructor(readonly sourceId: string, payload: StaticKnowledgePayload) { this.payload = deepFreeze(structuredClone(payload)); }
  async retrieve(request: KnowledgeRetrievalRequest): Promise<KnowledgeArtifact[]> { return [artifact(request, this.payload)]; }
}
export class InMemoryDocumentKnowledgeAdapter extends StaticStructuredKnowledgeAdapter {
  constructor(sourceId: string, document: { title: string; text: string; concepts?: StaticKnowledgePayload["concepts"]; facts?: StaticKnowledgePayload["facts"]; relationships?: StaticKnowledgePayload["relationships"] }) { super(sourceId, { contentType: "document", concepts: document.concepts, facts: document.facts, relationships: document.relationships, evidence: [{ type: "document", value: { title: document.title, text: document.text } }] }); }
}
export class KnowledgeModuleSourceAdapter extends StaticStructuredKnowledgeAdapter {
  constructor(sourceId: string, module: KnowledgeModule) { super(sourceId, { contentType: "module", concepts: module.concepts, relationships: module.relationships, evidence: (module.evidence ?? []).map((value) => ({ type: "provenance", value })), module, metadata: { moduleId: module.id } }); }
}
function artifact(request: KnowledgeRetrievalRequest, payload: StaticKnowledgePayload): KnowledgeArtifact { const module = payload.module; return { id: `artifact-${request.retrievalId}`, retrievalId: request.retrievalId, sourceId: request.source.id, requirementId: request.requirement.id, contentType: payload.contentType, concepts: structuredClone(payload.concepts ?? module?.concepts ?? []), facts: structuredClone(payload.facts ?? []), relationships: structuredClone(payload.relationships ?? module?.relationships ?? []), evidence: structuredClone(payload.evidence ?? []), freshness: request.requirement.freshness, retrievedAt: "1970-01-01T00:00:00.000Z", provenance: [{ sourceId: request.source.id, requirementId: request.requirement.id, citation: request.source.provenance?.citation, moduleId: module?.id }], metadata: structuredClone(payload.metadata ?? {}) }; }
function deepFreeze<T>(value: T): T { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item); return Object.freeze(value); }
