import type { SearchProvider, SearchRequest, SearchResponse, SearchResult, SearchSource } from "./search.types";

export const SEARCH_ORDER: readonly SearchSource[] = ["cache", "validated_experience", "project", "knowledge_graph", "capability_registry", "documentation", "web"];

/** Providers are registered by source, while the core remains agnostic to their implementation. */
export class SearchRouter {
  private readonly providers = new Map<SearchSource, SearchProvider[]>();

  register(provider: SearchProvider): void {
    const entries = this.providers.get(provider.source) ?? [];
    if (entries.some(({ id }) => id === provider.id)) throw new Error(`Search provider already registered: ${provider.id}`);
    this.providers.set(provider.source, [...entries, provider]);
  }

  async search(request: SearchRequest): Promise<SearchResponse> {
    if (!request.query.trim()) throw new TypeError("Search requires a query.");
    const sources = SEARCH_ORDER.filter((source) => !request.sources || request.sources.includes(source));
    const unavailableSources: SearchSource[] = [], searchedSources: SearchSource[] = [], results: SearchResult[] = [];
    const limit = request.maxResults ?? 8;
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError("maxResults must be positive.");
    for (const source of sources) {
      const available = (this.providers.get(source) ?? []).filter(({ available }) => available);
      if (!available.length) { unavailableSources.push(source); continue; }
      searchedSources.push(source);
      for (const provider of available) {
        const found = await provider.search(request);
        for (const item of found) {
          if (item.source !== source || item.provenance.sourceId !== provider.id) throw new Error(`Invalid search provenance from ${provider.id}`);
          if (item.confidence >= (request.minConfidence ?? 0)) results.push(item);
        }
      }
      const resolved = results.some((item) => item.resolvesRequest && item.provenance.validated && item.confidence >= (request.minConfidence ?? 0.8));
      if (resolved) return { status: "resolved", results: results.slice(0, limit), unavailableSources, searchedSources };
      if (results.length >= limit) break;
    }
    return { status: results.length ? "evidence" : unavailableSources.length ? "unavailable" : "no_results", results: results.slice(0, limit), unavailableSources, searchedSources };
  }
}
