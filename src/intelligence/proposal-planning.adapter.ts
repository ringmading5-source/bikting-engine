import { CapabilityRegistry } from "../capabilities/capability.registry";
import { validatePlanDependencies } from "../planning/planner";
import {
  ExecutionPlan,
  PlanOutputRequirement,
  PlanProvenanceReference,
  PlanStep,
  PlanVerificationRequirement,
} from "../planning/plan.types";
import { PlanInputBinding } from "../planning/input-binding.types";
import { validateCanonicalPlan } from "../bil/bil.planning.adapter";
import { ProposedBinding, ProposedTask, ReasoningResult } from "./intelligence-provider.types";
import { ReasoningRunResult } from "./reasoning.types";
import { stableIdentity } from "./intelligence-identity";

export interface ProposalPlanInput {
  projectId: string;
  run: ReasoningRunResult;
  capabilities: CapabilityRegistry;
  knowledgeContextId?: string;
  bilContextId?: string;
  /** Capability ids Bikting authorizes for planning. A proposal outside this set is rejected. */
  authorizedCapabilityIds?: readonly string[];
  /** Verification method applied to every capability step by default. */
  defaultVerificationMethod?: string;
  constraints?: ExecutionPlan["constraints"];
}

/**
 * AI proposes, Bikting plans.
 *
 * This adapter is the only path from a ReasoningResult to an ExecutionPlan, and it does exactly
 * three things: re-check the proposal against the registered capability catalogue and the
 * authorization allow-list, translate proposed tasks into canonical plan steps, and let the existing
 * plan validators run. It resolves no provider, holds no credentials, and executes nothing. Provider
 * resolution, authorization, and execution remain downstream responsibilities.
 */
export class ProposalPlanningAdapter {
  createPlan(input: ProposalPlanInput): ExecutionPlan {
    const { run } = input;
    if (!run.valid) throw new Error("A reasoning proposal with validation issues cannot be planned.");
    const authorized = input.authorizedCapabilityIds;
    const rejected = run.reasoning.requiredCapabilities.filter(({ capabilityId }) => authorized && !authorized.includes(capabilityId));
    if (rejected.length) throw new Error(`Proposal requires unauthorized capabilities: ${rejected.map(({ capabilityId }) => capabilityId).join(", ")}`);
    const capabilityById = new Map(input.capabilities.list().map((capability) => [capability.id, capability]));
    const requiredIds = unique([...run.reasoning.requiredCapabilities.map(({ capabilityId }) => capabilityId), ...run.reasoning.proposedTasks.map(({ capabilityId }) => capabilityId)]);
    const unresolvedCapabilityIds = requiredIds.filter((id) => !capabilityById.has(id));
    const steps: PlanStep[] = run.reasoning.proposedTasks.map((task) => this.stepFor(input, task, capabilityById.get(task.capabilityId), run.knowledgeContext));
    const provenance: PlanProvenanceReference[] = [{ sourceType: "engine", contextId: `reasoning:${run.reasoning.id}`, category: "intelligence_proposal" }];
    const plan: ExecutionPlan = {
      id: `plan-${stableIdentity({ projectId: input.projectId, reasoningId: run.reasoning.id, steps: steps.map(({ id, capabilityId }) => ({ id, capabilityId })) })}`,
      goal: run.reasoning.objective,
      bilContextId: input.bilContextId,
      knowledgeContextId: run.knowledgeContext?.id ?? input.knowledgeContextId,
      knowledgeContext: run.knowledgeContext,
      unresolvedKnowledgeRequirementIds: [...(run.knowledgeContext?.unresolvedRequirementIds ?? [])],
      steps,
      constraints: input.constraints,
      requiredCapabilityIds: requiredIds.filter((id) => !unresolvedCapabilityIds.includes(id)),
      unresolvedCapabilityIds,
      outputRequirements: outputRequirements(run.reasoning.outputRequirements, capabilityById),
      canonicalVerificationRequirements: verificationRequirements(run.reasoning.outputRequirements, input.defaultVerificationMethod),
      provenance,
      status: unresolvedCapabilityIds.length || run.knowledgeContext?.unresolvedRequirementIds.length ? "draft" : "ready",
    };
    if (plan.steps.length) {
      validateCanonicalPlan(plan);
      validatePlanDependencies(plan);
    }
    return deepFreeze(plan);
  }

  private stepFor(input: ProposalPlanInput, task: ProposedTask, capability: ReturnType<CapabilityRegistry["get"]>, knowledgeContext: ReasoningRunResult["knowledgeContext"]): PlanStep {
    const provenance: PlanProvenanceReference[] = [{ sourceType: "engine", contextId: `reasoning:${input.run.reasoning.id}`, category: "intelligence_proposal", declarationId: task.id }];
    const verificationMethod = input.defaultVerificationMethod;
    return {
      id: task.id,
      action: task.capabilityId,
      capabilityId: task.capabilityId,
      dependsOn: task.dependsOn?.length ? [...task.dependsOn] : [],
      inputBindings: (task.bindings ?? []).map((binding) => planBinding(task.id, binding)),
      expectedInputs: capability?.inputs.map(({ name, type }) => ({ name, type })) ?? [],
      expectedOutputs: capability?.outputs.map(({ name, type }) => ({ name, type })) ?? [],
      executionRequirements: [],
      verificationRequirements: verificationMethod ? [{ id: `verification-${task.id}`, method: verificationMethod, required: true, capabilityId: task.capabilityId, provenance: [...provenance] }] : [],
      outputRequirements: [],
      provenance,
      status: "pending",
      metadata: { knowledgeContextId: knowledgeContext?.id, purpose: task.purpose, required: task.required ?? true },
    } as PlanStep;
  }
}

function planBinding(taskId: string, binding: ProposedBinding): PlanInputBinding {
  if (binding.sourceType === "literal") return { target: binding.target, source: { type: "literal", value: structuredClone(binding.value) } };
  if (binding.sourceType === "task_output") return { target: binding.target, source: { type: "step_output", stepId: binding.taskId ?? taskId, path: [...(binding.path ?? [])] } };
  return { target: binding.target, source: { type: binding.sourceType, path: [...(binding.path ?? [])] } } as PlanInputBinding;
}

function outputRequirements(
  requirements: ReasoningResult["outputRequirements"],
  capabilityById: Map<string, ReturnType<CapabilityRegistry["get"]>>,
): PlanOutputRequirement[] {
  return requirements.map((requirement, index) => ({
    id: `output-${index + 1}-${requirement.type}`,
    type: requirement.type,
    required: requirement.required,
    capabilityId: requirement.capabilityId && capabilityById.has(requirement.capabilityId) ? requirement.capabilityId : undefined,
  }));
}

function verificationRequirements(
  requirements: ReasoningResult["outputRequirements"],
  verificationMethod?: string,
): PlanVerificationRequirement[] {
  if (!verificationMethod) return [];
  return requirements.filter(({ required }) => required).map((requirement, index) => ({ id: `verification-${index + 1}-${requirement.type}`, method: verificationMethod, required: true, capabilityId: requirement.capabilityId, description: requirement.description }));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  return Object.freeze(value);
}
