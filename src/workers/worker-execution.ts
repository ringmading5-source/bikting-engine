import type { SearchResponse } from "../search/search.types";
import { SearchRouter } from "../search/search.router";
import { ContextBuilder, estimateTokens, type ContextCandidate } from "./context-builder";
import { TokenBudgetController, WorkerModelRouter, estimateModelCost } from "./worker-routing";
import type { ContextPackage, ExecutionTelemetry, ValidationResult, WorkerPrompt, WorkerResponse, WorkerTask } from "./worker.types";
import type { ExecutionMemory, CostTelemetry } from "./execution-memory";

export class WorkerPromptBuilder {
  build(task: WorkerTask, context: ContextPackage): WorkerPrompt {
    return { role: task.requiredCapability, taskId: task.id, objective: task.objective, context,
      evidence: task.evidence.filter(({ id }) => context.items.some((item) => item.id === id)).map(({ id, source, provenance }) => ({ id, source, provenance: provenance.reference ?? provenance.sourceId })),
      constraints: [...task.constraints], requiredOutput: task.outputSchema, acceptanceCriteria: [...task.acceptanceCriteria],
      maxInputTokens: task.tokenBudget.maxInputTokens, maxOutputTokens: task.tokenBudget.maxOutputTokens };
  }
}

export class WorkerValidator {
  validate(task: WorkerTask, output: unknown): ValidationResult {
    const issues: ValidationResult["issues"][number][] = [];
    const schema = task.outputSchema;
    if (schema?.type === "object" && (output === null || Array.isArray(output) || typeof output !== "object")) issues.push({ code: "type", message: "Expected an object." });
    if (schema?.type === "string" && typeof output !== "string") issues.push({ code: "type", message: "Expected a string." });
    if (schema?.required?.length) for (const key of schema.required) {
      if (!output || typeof output !== "object" || !Object.hasOwn(output, key)) issues.push({ code: "required", message: `Missing ${key}.`, path: key });
    }
    return { valid: !issues.length, issues, method: "required_fields" };
  }
}

/** Escalation is a separate, recorded decision after evidence and targeted repair are exhausted. */
export function decideEscalation(task: WorkerTask, input: { attempts: number; searchExhausted: boolean; repairAttempted: boolean; failureCode: string }): { allowed: boolean; reason?: string } {
  if (!task.retryPolicy.allowEscalation || !input.searchExhausted || !input.repairAttempted || input.attempts < 2) return { allowed: false };
  if (!["insufficient_capability", "repeated_validation_failure"].includes(input.failureCode)) return { allowed: false };
  return { allowed: true, reason: `${input.failureCode}: search exhausted and targeted repair attempted after ${input.attempts} attempts` };
}

export interface WorkerRunResult {
  status: "resolved" | "completed" | "repair_required" | "blocked";
  output?: unknown;
  validation?: ValidationResult;
  repairTask?: WorkerTask;
  telemetry: readonly ExecutionTelemetry[];
  search?: SearchResponse;
  reason?: string;
}

export class WorkerExecutor {
  constructor(private readonly models: WorkerModelRouter, private readonly search: SearchRouter, private readonly contextBuilder = new ContextBuilder(), private readonly validator = new WorkerValidator(), private readonly promptBuilder = new WorkerPromptBuilder(), private readonly budgets = new TokenBudgetController(), private readonly telemetry?: CostTelemetry, private readonly memory?: ExecutionMemory) {}

  async run(task: WorkerTask, options: { remainingCost: number; context?: readonly ContextCandidate[]; allowSearchResolution?: boolean; escalationReason?: string }): Promise<WorkerRunResult> {
    const budget = this.budgets.allocate(task, options.remainingCost);
    const search = await this.search.search({ query: task.objective, projectId: task.projectId, maxResults: 5 });
    if (options.allowSearchResolution !== false && search.status === "resolved") {
      const resolved = search.results.find((item) => item.resolvesRequest && item.provenance.validated && item.confidence >= 0.8);
      if (resolved) { this.telemetry?.recordResolution(resolved.source === "cache" || resolved.source === "validated_experience" ? "cache" : "search"); return { status: "resolved", output: resolved.content, validation: { valid: true, issues: [], method: "validated_search" }, telemetry: [], search }; }
    }
    const enriched: WorkerTask = { ...task, tokenBudget: budget, evidence: [...task.evidence, ...search.results] };
    const context = this.contextBuilder.build(enriched, options.context ?? []);
    const candidates = this.models.suitable(enriched, context.estimatedTokens).filter((provider) => provider.executeWorker);
    if (!candidates.length) return { status: "blocked", telemetry: [], search, reason: "No suitable bounded worker fits the capability and cost budget." };
    const provider = candidates[0];
    const model = provider.capabilities.model!;
    const prompt = this.promptBuilder.build(enriched, context);
    const started = Date.now();
    let response: WorkerResponse;
    try { response = await provider.executeWorker!(prompt); }
    catch (error) {
      const failed: ExecutionTelemetry = { provider: model.provider, model: model.model, taskId: task.id, inputTokensEstimated: context.estimatedTokens,
        outputTokens: 0, estimatedCost: estimateModelCost(model, context.estimatedTokens, 0), latencyMs: Date.now() - started,
        attempt: 1, validationResult: "failed", escalationReason: options.escalationReason };
      this.telemetry?.record(failed);
      return { status: "blocked", telemetry: [failed], search, reason: error instanceof Error ? error.message : String(error) };
    }
    const validation = this.validator.validate(enriched, response.output);
    const inputTokens = response.inputTokens ?? context.estimatedTokens;
    const outputTokens = response.outputTokens ?? estimateTokens(response.output);
    const call: ExecutionTelemetry = { provider: model.provider, model: model.model, taskId: task.id, inputTokensEstimated: context.estimatedTokens,
      inputTokensActual: response.inputTokens, outputTokens, estimatedCost: estimateModelCost(model, inputTokens, outputTokens), actualCost: response.actualCost,
      latencyMs: Date.now() - started, attempt: 1, validationResult: validation.valid ? "passed" : "failed", escalationReason: options.escalationReason };
    if (inputTokens > budget.maxInputTokens || outputTokens > budget.maxOutputTokens) {
      call.validationResult = "failed"; this.telemetry?.record(call);
      return { status: "blocked", output: response.output, validation: { valid: false, method: "token_limits", issues: [{ code: "token_limit", message: "Provider exceeded the worker token limit." }] },
        telemetry: [call], search, reason: "Provider exceeded the worker token limit." };
    }
    this.telemetry?.record(call);
    if (validation.valid) {
      await this.memory?.store({ id: `${task.projectId}:${task.id}`, projectId: task.projectId, taskId: task.id, intent: task.objective,
        relationships: [], capabilityIds: [task.requiredCapability], evidenceIds: enriched.evidence.map(({ id }) => id), workerId: provider.id,
        result: response.output, validation, repairHistory: task.parentTaskId ? [task.parentTaskId] : [], recordedAt: new Date().toISOString() });
      return { status: "completed", output: response.output, validation, telemetry: [call], search };
    }
    const repairTask = task.retryPolicy.allowTargetedRepair && budget.maxAttempts > 1 ? targetedRepair(enriched, validation) : undefined;
    return { status: repairTask ? "repair_required" : "blocked", output: response.output, validation, repairTask, telemetry: [call], search,
      reason: repairTask ? "Output failed deterministic validation; a targeted repair is available." : "Output failed validation; retry is disabled." };
  }
}

export function targetedRepair(task: WorkerTask, validation: ValidationResult): WorkerTask {
  return { ...task, id: `${task.id}:repair`, parentTaskId: task.id,
    objective: `Repair the output for ${task.id}: ${validation.issues.map(({ code, path }) => `${code}${path ? `:${path}` : ""}`).join(", ")}`,
    inputs: { originalTaskId: task.id, errors: validation.issues }, evidence: [],
    tokenBudget: { ...task.tokenBudget, maxInputTokens: Math.min(task.tokenBudget.maxInputTokens, 600), maxAttempts: task.tokenBudget.maxAttempts - 1 },
    retryPolicy: { ...task.retryPolicy, allowEscalation: false } };
}
