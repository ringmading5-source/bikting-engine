import { BilContext, BilProvenance } from "./bil.types";
import { ExecutionPlan, PlanExecutionRequirement, PlanOutputRequirement, PlanProvenanceReference, PlanStep, PlanVerificationRequirement } from "../planning/plan.types";
import { validatePlanDependencies } from "../planning/planner";
import type { KnowledgeContext } from "../knowledge/knowledge-context";

/** Converts immutable BIL context into a canonical plan without resolving providers or executing work. */
export class BilPlanningAdapter {
  createPlan(context: BilContext, knowledgeContext?: KnowledgeContext): ExecutionPlan {
    const capabilityById = new Map(context.capabilities.map((capability) => [capability.id, capability]));
    const workflowCapabilityIds = new Set(context.workflows.flatMap(({ steps }) => steps.map(({ capabilityId }) => capabilityId)));
    const steps: PlanStep[] = context.workflows.flatMap((workflow) => workflow.steps.map((step) => stepFor(
      context, step.id, step.capabilityId, [...(step.dependsOn ?? [])], step.provenance, capabilityById.get(step.capabilityId),
    )));
    for (const requirement of context.capabilityRequirements) {
      if (!requirement.declaration.required || workflowCapabilityIds.has(requirement.declaration.capabilityId)) continue;
      const id = `step-${requirement.declaration.capabilityId.replaceAll(".", "-")}`;
      steps.push(stepFor(context, id, requirement.declaration.capabilityId, [], requirement.provenance, capabilityById.get(requirement.declaration.capabilityId)));
    }
    const unresolvedCapabilityIds = [...new Set(context.unresolvedReferences.filter(({ type }) => type === "unknown_capability" || type === "missing_workflow_capability").map(({ reference }) => reference).filter((id): id is string => Boolean(id)))].sort();
    const plan: ExecutionPlan = {
      id: `plan-${context.id}`,
      goal: context.intent.goal,
      originatingIntent: structuredClone(context.intent),
      bilContextId: context.id,
      knowledgeContextId: knowledgeContext?.id,
      knowledgeContext,
      unresolvedKnowledgeRequirementIds: [...(knowledgeContext?.unresolvedRequirementIds ?? [])],
      steps,
      constraints: context.constraints.map(({ declaration }) => structuredClone(declaration)),
      canonicalConstraints: context.constraints.map(({ declaration, provenance }) => ({ ...structuredClone(declaration), provenance: provenance.map((item) => planProvenance(context.id, item)) })),
      requiredCapabilityIds: [...context.requiredCapabilityIds],
      verificationRequirements: context.verificationRequirements.map(({ declaration }) => declaration.method),
      canonicalVerificationRequirements: context.verificationRequirements.map(({ declaration, provenance }) => ({ ...structuredClone(declaration), provenance: provenance.map((item) => planProvenance(context.id, item)) })),
      executionRequirements: context.executionRequirements.map(({ declaration, provenance }) => ({ ...structuredClone(declaration), provenance: provenance.map((item) => planProvenance(context.id, item)) })),
      outputRequirements: context.outputRequirements.map(({ declaration, provenance }) => ({ ...structuredClone(declaration), provenance: provenance.map((item) => planProvenance(context.id, item)) })),
      unresolvedCapabilityIds,
      provenance: context.sourceModules.map(({ id, version }) => ({ sourceType: "bil", contextId: context.id, moduleId: id, moduleVersion: version })),
      status: unresolvedCapabilityIds.length || knowledgeContext?.unresolvedRequirementIds.length ? "draft" : "ready",
    };
    validateInputBindings(plan);
    validateCanonicalPlan(plan);
    return deepFreeze(plan);
  }
}

export function validateCanonicalPlan(plan: ExecutionPlan): void {
  const ids = new Set<string>();
  const declaredCapabilities = new Set([...(plan.requiredCapabilityIds ?? []), ...(plan.unresolvedCapabilityIds ?? [])]);
  for (const step of plan.steps) {
    if (ids.has(step.id)) throw new Error(`Duplicate plan step id: ${step.id}`);
    ids.add(step.id);
    if (!step.capabilityId) throw new Error(`Plan step ${step.id} has no required capability.`);
    if (!declaredCapabilities.has(step.capabilityId)) throw new Error(`Plan step ${step.id} references undeclared capability ${step.capabilityId}.`);
    if (!step.provenance?.length) throw new Error(`Plan step ${step.id} has no provenance.`);
    if (!step.expectedOutputs) throw new Error(`Plan step ${step.id} has no expected output representation.`);
    if (!step.verificationRequirements) throw new Error(`Plan step ${step.id} has no verification requirement representation.`);
  }
  validatePlanDependencies(plan);
}

function stepFor(context: BilContext, id: string, capabilityId: string, dependsOn: string[], provenance: readonly BilProvenance[], capability?: BilContext["capabilities"][number]): PlanStep {
  const workflowStep = context.workflows.flatMap(({ steps }) => steps).find((step) => step.id === id);
  const verificationRequirements: PlanVerificationRequirement[] = context.verificationRequirements.filter(({ declaration }) => !declaration.capabilityId || declaration.capabilityId === capabilityId).map(({ declaration, provenance: source }) => ({ ...structuredClone(declaration), provenance: source.map((item) => planProvenance(context.id, item)) }));
  const outputRequirements: PlanOutputRequirement[] = context.outputRequirements.filter(({ declaration }) => !declaration.capabilityId || declaration.capabilityId === capabilityId).map(({ declaration, provenance: source }) => ({ ...structuredClone(declaration), provenance: source.map((item) => planProvenance(context.id, item)) }));
  const executionRequirements: PlanExecutionRequirement[] = context.executionRequirements.map(({ declaration, provenance: source }) => ({ ...structuredClone(declaration), provenance: source.map((item) => planProvenance(context.id, item)) }));
  return {
    id, action: capabilityId, capabilityId, dependsOn, inputBindings: structuredClone(workflowStep?.inputBindings ?? []),
    expectedInputs: capability?.inputs.map((item) => ({ ...item })) ?? [],
    expectedOutputs: capability?.outputs.map((item) => ({ ...item })) ?? outputRequirements.map(({ id: name, type }) => ({ name, type })),
    executionRequirements, verificationRequirements, outputRequirements,
    provenance: provenance.map((item) => planProvenance(context.id, item)), status: "pending",
  };
}

export function validateInputBindings(plan: ExecutionPlan): void {
  const steps = new Map(plan.steps.map((step) => [step.id, step]));
  const upstream = (stepId: string, candidate: string, seen = new Set<string>()): boolean => {
    if (seen.has(stepId)) return false; seen.add(stepId);
    const dependencies = steps.get(stepId)?.dependsOn ?? [];
    return dependencies.includes(candidate) || dependencies.some((id) => upstream(id, candidate, seen));
  };
  for (const step of plan.steps) {
    const targets = new Set<string>();
    for (const binding of step.inputBindings ?? []) {
      if (targets.has(binding.target)) throw new Error(`Duplicate input binding target ${binding.target} in ${step.id}.`);
      targets.add(binding.target);
      if (step.expectedInputs?.length && !step.expectedInputs.some(({ name }) => name === binding.target)) throw new Error(`Unknown target input ${binding.target} in ${step.id}.`);
      if (binding.source.type === "step_output") {
        const source = steps.get(binding.source.stepId);
        const outputPath = binding.source.path;
        if (!source) throw new Error(`Input binding in ${step.id} references unknown step ${binding.source.stepId}.`);
        if (!upstream(step.id, source.id)) throw new Error(`Input binding in ${step.id} references non-upstream step ${source.id}.`);
        if (!outputPath.length || outputPath.some((part) => !part)) throw new Error(`Input binding in ${step.id} has an invalid output path.`);
        if (source.expectedOutputs?.length && !source.expectedOutputs.some(({ name, type }) => name === outputPath[0] || type === outputPath[0])) throw new Error(`Input binding in ${step.id} references unknown output ${outputPath[0]} from ${source.id}.`);
      }
      if ((binding.source.type === "intent" || binding.source.type === "context") && (!binding.source.path.length || binding.source.path.some((part) => !part))) throw new Error(`Input binding in ${step.id} has an invalid source path.`);
      if (binding.source.type === "literal" && containsExecutable(binding.source.value)) throw new Error(`Input binding in ${step.id} contains a non-data literal.`);
    }
  }
}

function containsExecutable(value: unknown): boolean { if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint" || value === undefined) return true; if (Array.isArray(value)) return value.some(containsExecutable); return Boolean(value && typeof value === "object" && Object.values(value as Record<string, unknown>).some(containsExecutable)); }

function planProvenance(contextId: string, source: BilProvenance): PlanProvenanceReference { return { sourceType: "bil", contextId, moduleId: source.moduleId, moduleVersion: source.moduleVersion, category: source.category, declarationId: source.declarationId }; }
function deepFreeze<T>(value: T): T { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item); return Object.freeze(value); }
