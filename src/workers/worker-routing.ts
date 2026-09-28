import type { IntelligenceProvider, ModelCapability } from "../intelligence/intelligence-provider.types";
import { IntelligenceProviderRegistry } from "../intelligence/intelligence-provider.registry";
import type { TokenBudget, WorkerTask } from "./worker.types";

export class TokenBudgetController {
  allocate(task: Pick<WorkerTask, "tokenBudget">, remainingCost: number): TokenBudget {
    const budget = task.tokenBudget;
    if (![budget.maxInputTokens, budget.maxOutputTokens, budget.maxAttempts].every((value) => Number.isInteger(value) && value > 0)) throw new RangeError("Token limits and attempts must be positive integers.");
    if (!Number.isFinite(remainingCost) || remainingCost < 0 || !Number.isFinite(budget.maxEstimatedCost) || budget.maxEstimatedCost < 0) throw new RangeError("Invalid cost budget.");
    return { ...budget, maxEstimatedCost: Math.min(remainingCost, budget.maxEstimatedCost) };
  }
}

const rank = { low: 1, medium: 2, high: 3 };
export function estimateModelCost(model: ModelCapability, inputTokens: number, outputTokens: number): number {
  return (inputTokens * model.inputCostPerMillion + outputTokens * model.outputCostPerMillion) / 1_000_000;
}

export class WorkerModelRouter {
  constructor(private readonly providers: IntelligenceProviderRegistry) {}

  suitable(task: WorkerTask, inputTokens: number): IntelligenceProvider[] {
    const budget = task.tokenBudget;
    return this.providers.forTask(task.requiredCapability).filter(({ capabilities }) => {
      const model = capabilities.model;
      if (!model || model.contextWindow < inputTokens || model.maxOutputTokens < budget.maxOutputTokens) return false;
      if (task.requirements?.coding && rank[model.coding ?? "low"] < rank[task.requirements.coding]) return false;
      if (task.requirements?.reasoning && rank[model.reasoning ?? "low"] < rank[task.requirements.reasoning]) return false;
      if (task.requirements?.structuredOutput && !(model.structuredOutput ?? capabilities.supportsStructuredOutput)) return false;
      if (task.requiredCapability === "vision" && !model.vision) return false;
      return estimateModelCost(model, inputTokens, budget.maxOutputTokens) <= budget.maxEstimatedCost;
    }).sort((a, b) => estimateModelCost(a.capabilities.model!, inputTokens, budget.maxOutputTokens) - estimateModelCost(b.capabilities.model!, inputTokens, budget.maxOutputTokens) || a.id.localeCompare(b.id));
  }

  select(task: WorkerTask, inputTokens: number): IntelligenceProvider | undefined { return this.suitable(task, inputTokens)[0]; }
}
