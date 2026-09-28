export type SearchSource = "cache" | "validated_experience" | "project" | "knowledge_graph" | "capability_registry" | "documentation" | "web";

export interface SearchRequest {
  query: string;
  projectId?: string;
  sources?: readonly SearchSource[];
  maxResults?: number;
  minConfidence?: number;
  /** Only a validated, complete answer can resolve a request without a worker. */
  requireResolution?: boolean;
}

export interface SearchEvidence {
  sourceId: string;
  reference?: string;
  retrievedAt?: string;
  validated?: boolean;
}

export interface SearchResult {
  id: string;
  source: SearchSource;
  relevance: number;
  confidence: number;
  freshness?: string;
  provenance: SearchEvidence;
  content: unknown;
  estimatedTokens: number;
  resolvesRequest?: boolean;
}

export interface SearchProvider {
  id: string;
  source: SearchSource;
  available: boolean;
  search(request: SearchRequest): Promise<readonly SearchResult[]>;
}

export interface SearchResponse {
  status: "resolved" | "evidence" | "unavailable" | "no_results";
  results: readonly SearchResult[];
  unavailableSources: readonly SearchSource[];
  searchedSources: readonly SearchSource[];
}
