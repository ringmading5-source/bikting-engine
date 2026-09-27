import { CapabilityRegistry } from "../capabilities/capability.registry";
import { resolveCapabilities } from "../capabilities/capability.resolver";
import { UserIntent } from "../intent/intent.types";
import { resolveIntent } from "../intent/intent.resolver";
import { ExecutionPlan, PlanStep } from "./plan.types";

export class Planner {
  constructor(private capabilities: CapabilityRegistry) {}

  createPlan(intent: UserIntent): ExecutionPlan {
    const requirements = resolveIntent(intent);
    const steps: PlanStep[] = [];
    const capabilityIds = new Set<string>();
    for (const operation of requirements.operations) {
      const resolution = resolveCapabilities(this.capabilities, operation);
      if (resolution.unavailable) {
        steps.push({ id: `step-${steps.length + 1}`, action: operation, status: "failed" });
        continue;
      }
      const capability = resolution.capabilities[0];
      capabilityIds.add(capability.id);
      steps.push({
        id: `step-${steps.length + 1}`,
        action: operation,
        capabilityId: capability.id,
        status: "pending",
        requiredAccess: capability.access ? [{ capabilityId: capability.id, requirement: capability.access.requirement, provider: capability.access.provider }] : [],
        verification: capability.verificationMethod ? { method: capability.verificationMethod, required: true } : undefined,
      });
    }
    const plan: ExecutionPlan = {
      id: `plan-${Date.now()}`,
      goal: intent.goal,
      constraints: requirements.constraints,
      steps,
      requiredCapabilityIds: [...capabilityIds],
      verificationRequirements: steps.flatMap((step) => step.verification?.method ? [step.verification.method] : []),
      status: steps.some((step) => step.status === "failed") ? "draft" : "ready",
    };
    validatePlanDependencies(plan);
    return plan;
  }
}

export function validatePlanDependencies(plan: ExecutionPlan): void {
  const steps = new Map(plan.steps.map((step) => [step.id, step]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (step: PlanStep): void => {
    if (visited.has(step.id)) return;
    if (visiting.has(step.id)) throw new Error(`Plan contains a dependency cycle at ${step.id}`);
    visiting.add(step.id);
    for (const dependencyId of step.dependsOn ?? []) {
      const dependency = steps.get(dependencyId);
      if (!dependency) throw new Error(`Plan step ${step.id} depends on unknown step ${dependencyId}`);
      visit(dependency);
    }
    visiting.delete(step.id);
    visited.add(step.id);
  };
  for (const step of plan.steps) visit(step);
}
