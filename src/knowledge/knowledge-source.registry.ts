import { KnowledgeSource, KnowledgeSourceType } from "./knowledge-source.types";

export class KnowledgeSourceRegistry {
  private readonly sources = new Map<string, KnowledgeSource>();
  register(source: KnowledgeSource): KnowledgeSource { if (this.sources.has(source.id)) throw new Error(`Knowledge source already registered: ${source.id}`); const copy = deepFreeze(structuredClone(source)); this.sources.set(copy.id, copy); return copy; }
  get(id: string): KnowledgeSource | undefined { return this.sources.get(id); }
  has(id: string): boolean { return this.sources.has(id); }
  list(): KnowledgeSource[] { return [...this.sources.values()].sort((a, b) => a.id.localeCompare(b.id)); }
  query(filter: { domain?: string; type?: KnowledgeSourceType; conceptIds?: string[] } = {}): KnowledgeSource[] { return this.list().filter((source) => (!filter.domain || source.domains.includes(filter.domain)) && (!filter.type || source.type === filter.type) && (!(filter.conceptIds?.length) || filter.conceptIds.some((id) => source.conceptIds?.includes(id)))); }
}
function deepFreeze<T>(value: T): T { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item); return Object.freeze(value); }
