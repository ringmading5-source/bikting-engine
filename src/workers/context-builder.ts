import type { SearchResult } from "../search/search.types";
import type { ContextPackage, WorkerTask } from "./worker.types";

export interface ContextCandidate { id: string; content: unknown; source: string; estimatedTokens: number; taskIds?: readonly string[]; relevance?: number }

export class ContextBuilder {
  build(task: WorkerTask, candidates: readonly ContextCandidate[], evidence: readonly SearchResult[] = task.evidence): ContextPackage {
    const max = task.tokenBudget.maxInputTokens;
    const overhead = estimateTokens({ objective: task.objective, inputs: task.inputs, constraints: task.constraints, acceptanceCriteria: task.acceptanceCriteria });
    if (overhead > max) throw new RangeError("Task instructions exceed the input token budget.");
    const selected: ContextPackage["items"][number][] = [], omittedIds: string[] = [];
    let tokens = overhead;
    const items = [...candidates.filter((candidate) => candidate.taskIds?.includes(task.id) || (!candidate.taskIds && (candidate.relevance ?? 0) >= 0.7)),
      ...evidence.map((item) => ({ id: item.id, content: item.content, source: item.source, estimatedTokens: item.estimatedTokens, relevance: item.relevance }))];
    items.sort((a, b) => (b.relevance ?? 1) - (a.relevance ?? 1));
    for (const item of items) {
      if (item.estimatedTokens < 0 || !Number.isFinite(item.estimatedTokens)) throw new RangeError("Invalid context token estimate.");
      if (tokens + item.estimatedTokens > max) { omittedIds.push(item.id); continue; }
      tokens += item.estimatedTokens;
      selected.push({ id: item.id, content: item.content, source: item.source, estimatedTokens: item.estimatedTokens });
    }
    return { taskId: task.id, items: selected, estimatedTokens: tokens, omittedIds };
  }
}

/** Conservative estimate, never treated as a provider's authoritative token count. */
export function estimateTokens(value: unknown): number { return Math.ceil(JSON.stringify(value).length / 3); }
