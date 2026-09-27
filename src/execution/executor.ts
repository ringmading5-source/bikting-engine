import { validatePlanDependencies } from "../planning/planner";
import { ExecutionPlan, PlanStep } from "../planning/plan.types";
import { CapabilityAdapter, ExecutionContext, ExecutionResult } from "./execution.types";

export class ExecutionExecutor {
  constructor(private adapters = new Map<string, CapabilityAdapter>()) {}

  registerAdapter(adapter: CapabilityAdapter): void {
    this.adapters.set(adapter.capabilityId, adapter);
  }

  async execute(plan: ExecutionPlan): Promise<ExecutionContext> {
    validatePlanDependencies(plan);
    const context: ExecutionContext = { plan, results: new Map() };
    const pending = new Map(plan.steps.map((step) => [step.id, step]));
    while (pending.size) {
      const ready = [...pending.values()].filter((step) => (step.dependsOn ?? []).every((id) => context.results.has(id)));
      if (!ready.length) throw new Error("Plan dependencies cannot be executed.");
      for (const step of ready) {
        const dependencyFailed = (step.dependsOn ?? []).some((id) => context.results.get(id)?.status !== "completed");
        const result = dependencyFailed ? blocked(step) : await this.executeStep(step, context);
        context.results.set(step.id, result);
        pending.delete(step.id);
      }
    }
    return context;
  }

  private async executeStep(step: PlanStep, context: ExecutionContext): Promise<ExecutionResult> {
    if (!step.capabilityId) return completed(step, undefined, "engine", "engine");
    const adapter = this.adapters.get(step.capabilityId);
    if (!adapter) return failed(step, `No adapter is registered for ${step.capabilityId}`, step.capabilityId);
    try {
      return completed(step, await adapter.execute(step.inputs ?? {}, context), "adapter", adapter.capabilityId);
    } catch (error) {
      return failed(step, error instanceof Error ? error.message : String(error), adapter.capabilityId);
    }
  }
}

function completed(step: PlanStep, output: unknown, sourceType: "capability" | "adapter" | "engine", sourceId: string): ExecutionResult {
  return { stepId: step.id, status: "completed", output, provenance: { sourceType, sourceId, observedAt: new Date().toISOString() } };
}
function failed(step: PlanStep, message: string, sourceId: string): ExecutionResult {
  return { stepId: step.id, status: "failed", error: { message }, provenance: { sourceType: "capability", sourceId, observedAt: new Date().toISOString() } };
}
function blocked(step: PlanStep): ExecutionResult {
  return { stepId: step.id, status: "blocked", error: { message: "A dependency did not complete." }, provenance: { sourceType: "engine", sourceId: "engine", observedAt: new Date().toISOString() } };
}
