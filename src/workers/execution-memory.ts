import type { ExecutionTelemetry, ValidationResult } from "./worker.types";
import type { SearchProvider, SearchRequest, SearchResult } from "../search/search.types";

export interface ValidatedExecution {
  id: string;
  projectId: string;
  taskId: string;
  intent: string;
  relationships: readonly string[];
  capabilityIds: readonly string[];
  evidenceIds: readonly string[];
  workerId?: string;
  result: unknown;
  validation: ValidationResult;
  repairHistory: readonly string[];
  recordedAt: string;
}

/** Adapter can later be replaced by durable storage and semantic indexing. */
export interface ExecutionMemory { find(query: string, projectId?: string): Promise<readonly ValidatedExecution[]>; store(record: ValidatedExecution): Promise<void> }

export class InMemoryValidatedExecutionMemory implements ExecutionMemory {
  private readonly records = new Map<string, ValidatedExecution>();
  async find(query: string, projectId?: string): Promise<readonly ValidatedExecution[]> {
    return [...this.records.values()].filter((record) => record.intent === query && (!projectId || record.projectId === projectId)).map((item) => structuredClone(item));
  }
  async store(record: ValidatedExecution): Promise<void> {
    if (!record.validation.valid) throw new Error("Only validated execution can be reused.");
    this.records.set(record.id, structuredClone(record));
  }
}

export class ValidatedExperienceSearchProvider implements SearchProvider {
  readonly source = "validated_experience" as const;
  readonly available = true;
  constructor(readonly id: string, private readonly memory: ExecutionMemory) {}
  async search(request: SearchRequest): Promise<readonly SearchResult[]> {
    return (await this.memory.find(request.query, request.projectId)).map((record) => ({ id: record.id, source: this.source, relevance: 1, confidence: 1,
      freshness: record.recordedAt, provenance: { sourceId: this.id, reference: record.id, validated: true }, content: record.result,
      estimatedTokens: Math.ceil(JSON.stringify(record.result).length / 3), resolvesRequest: true }));
  }
}

export interface UsageSummary { totalModelCalls: number; totalInputTokens: number; totalOutputTokens: number; estimatedCost: number | null; actualCostKnown: number; cacheHits: number; searchResolutions: number; deterministicResolutions: number; escalations: number }
export class CostTelemetry {
  private readonly calls: ExecutionTelemetry[] = [];
  private cacheHits = 0; private searchResolutions = 0; private deterministicResolutions = 0;
  record(call: ExecutionTelemetry): void { this.calls.push({ ...call }); }
  recordResolution(kind: "cache" | "search" | "deterministic"): void { if (kind === "cache") this.cacheHits++; else if (kind === "search") this.searchResolutions++; else this.deterministicResolutions++; }
  summary(): UsageSummary { return { totalModelCalls: this.calls.length, totalInputTokens: this.calls.reduce((n, call) => n + (call.inputTokensActual ?? call.inputTokensEstimated), 0),
    totalOutputTokens: this.calls.reduce((n, call) => n + call.outputTokens, 0), estimatedCost: this.calls.some((call) => call.estimatedCost === null) ? null : this.calls.reduce((n, call) => n + (call.estimatedCost ?? 0), 0),
    actualCostKnown: this.calls.reduce((n, call) => n + (call.actualCost ?? 0), 0), cacheHits: this.cacheHits, searchResolutions: this.searchResolutions,
    deterministicResolutions: this.deterministicResolutions, escalations: this.calls.filter(({ escalationReason }) => Boolean(escalationReason)).length }; }
}
