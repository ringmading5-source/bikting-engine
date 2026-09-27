import { AuthorizationGrant } from "../core/access";
import { evaluatePlanAuthorization, PlanAuthorizationEvaluation } from "../core/authorization";
import { RelationshipTypeRegistry } from "../core/relationship.registry";
import { Relationship } from "../core/types";
import { CapabilityRegistry } from "../capabilities/capability.registry";
import { InMemoryExecutionEventLog } from "../execution/event-log";
import { ExecutionEvent } from "../execution/events";
import { UserIntent } from "../intent/intent.types";
import { ExecutionPlan } from "../planning/plan.types";
import { PreparedExecutionPlan, prepareExecutionPlan, withProviderSelections } from "../planning/prepared-plan";
import { projectShadowProjectState, ShadowProjectState } from "../projects/shadow-project-state";
import { CapabilityProviderRegistry } from "../providers/provider.registry";
import { resolvePlanProviders, PlanProviderResolution } from "../providers/provider.resolver";
import { ProviderSelection, ProviderSelectionPolicy, selectPreparedPlanProviders, StableFirstAuthorizedProviderPolicy } from "../providers/provider-selection.policy";
import { BilCompiler } from "./bil.compiler";
import { BilCompilationError } from "./bil.errors";
import { BilPlanningAdapter } from "./bil.planning.adapter";
import { BilRegistry } from "./bil.registry";
import { resolveBil } from "./bil.resolver";
import { BilContext, BilResolution, BilResolutionInput } from "./bil.types";

export type ShadowDiagnosticKind = "module_selection" | "capability" | "provider" | "authorization" | "policy" | "readiness" | "compilation";
export interface ShadowDiagnostic { kind: ShadowDiagnosticKind; status: "info" | "warning" | "error"; message: string; references: string[]; }
export type ShadowPipelineStatus = "ready" | "partial" | "blocked" | "unresolved" | "failed";
export interface ShadowPipelineInput {
  projectId: string;
  intent: UserIntent;
  bilRegistry: BilRegistry;
  capabilityRegistry: CapabilityRegistry;
  providerRegistry: CapabilityProviderRegistry;
  relationshipTypeRegistry: RelationshipTypeRegistry;
  authorizationGrants?: readonly AuthorizationGrant[];
  providerPolicy?: ProviderSelectionPolicy;
  projectContext?: { requestedCapabilityIds?: string[]; availableCapabilityIds?: string[]; relationships?: Relationship[]; modality?: string; values?: Record<string, unknown> };
}
export interface ShadowPipelineResult {
  runId: string; projectId: string; status: ShadowPipelineStatus;
  resolution: BilResolution; context?: BilContext; plan?: ExecutionPlan;
  providerResolution?: PlanProviderResolution; authorization?: PlanAuthorizationEvaluation;
  providerSelections?: ProviderSelection[]; preparedPlan?: PreparedExecutionPlan;
  events: ExecutionEvent[]; projectState: ShadowProjectState;
  unresolvedRequirements: string[]; blockedRequirements: string[]; diagnostics: ShadowDiagnostic[];
}

/** Read-only composition root for BIL planning. It cannot invoke a provider, tool, API, or executor. */
export class ShadowBiktingPipeline {
  run(input: ShadowPipelineInput): ShadowPipelineResult {
    const resolutionInput = toResolutionInput(input);
    const runId = `shadow-${hash(stableStringify({ projectId: input.projectId, intent: input.intent, resolutionInput, modules: input.bilRegistry.list().map(({ id, version }) => ({ id, version })), capabilities: input.capabilityRegistry.list().map(({ id }) => id).sort(), providers: input.providerRegistry.list().map(({ id, availability }) => ({ id, availability })).sort((a, b) => a.id.localeCompare(b.id)), grants: [...(input.authorizationGrants ?? [])].map(({ id, status }) => ({ id, status })).sort((a, b) => a.id.localeCompare(b.id)), policy: input.providerPolicy?.id ?? "stable-first-authorized-provider" }))}`;
    const log = new InMemoryExecutionEventLog(runId); const diagnostics: ShadowDiagnostic[] = [];
    log.append({ type: "intent_received", projectId: input.projectId, data: { goal: input.intent.goal } });
    log.append({ type: "bil_resolution_started", projectId: input.projectId });
    const resolution = resolveBil(input.bilRegistry, resolutionInput);
    log.append({ type: "bil_resolution_completed", projectId: input.projectId, data: { resolutionId: resolution.id, selectedModuleIds: resolution.selectedModuleIds, unresolvedRequirements: resolution.unresolvedRequirements.map(({ id }) => id) }, metadata: { provenance: resolution.selectedModuleVersions } });
    diagnostics.push(...resolution.selections.map(({ moduleId, reasons }) => diagnostic("module_selection", "info", `Selected ${moduleId}: ${reasons.join("; ")}.`, [moduleId])));
    diagnostics.push(...resolution.unresolvedRequirements.map(({ id, reason }) => diagnostic("capability", "warning", reason, [id])));
    try {
      const modules = resolution.selectedModuleIds.map((id) => input.bilRegistry.get(id)).filter((module): module is NonNullable<typeof module> => Boolean(module));
      const context = new BilCompiler().compile({ intent: input.intent, resolution, modules, bilRegistry: input.bilRegistry, capabilityRegistry: input.capabilityRegistry, relationshipTypeRegistry: input.relationshipTypeRegistry });
      log.append({ type: "bil_context_compiled", projectId: input.projectId, data: { contextId: context.id, resolutionId: resolution.id }, metadata: { moduleIds: context.sourceModules.map(({ id }) => id) } });
      log.append({ type: "planning_started", projectId: input.projectId, data: { contextId: context.id } });
      const plan = new BilPlanningAdapter().createPlan(context);
      log.append({ type: "planning_completed", projectId: input.projectId, data: { planId: plan.id, stepIds: plan.steps.map(({ id }) => id) }, metadata: { provenance: plan.provenance?.map(({ moduleId, declarationId }) => ({ moduleId, declarationId })) } });
      log.append({ type: "provider_resolution_started", projectId: input.projectId, data: { planId: plan.id } });
      const providerResolution = resolvePlanProviders(plan, input.capabilityRegistry, input.providerRegistry);
      const providerStatus = providerResolution.unresolvedStepIds.length === 0 ? "resolved" : providerResolution.unresolvedStepIds.length === plan.steps.length ? "unresolved" : "partial";
      log.append({ type: "provider_resolution_completed", projectId: input.projectId, data: { planId: plan.id, status: providerStatus, unresolvedStepIds: providerResolution.unresolvedStepIds }, metadata: { candidates: Object.fromEntries(providerResolution.steps.map(({ stepId, candidateProviderIds }) => [stepId, candidateProviderIds])) } });
      diagnostics.push(...providerResolution.steps.map(({ stepId, status, candidateProviderIds }) => diagnostic("provider", status === "resolved" ? "info" : "warning", `${stepId}: ${status}; candidates: ${candidateProviderIds.join(", ") || "none"}.`, [stepId, ...candidateProviderIds])));
      const authorization = evaluatePlanAuthorization(providerResolution, input.authorizationGrants ?? []);
      const authorizationStatus = authorization.blockedStepIds.length ? "blocked" : authorization.unresolvedStepIds.length ? "unresolved" : "authorized";
      log.append({ type: "authorization_evaluated", projectId: input.projectId, data: { planId: plan.id, status: authorizationStatus, blockedStepIds: authorization.blockedStepIds, unresolvedStepIds: authorization.unresolvedStepIds } });
      diagnostics.push(...authorization.steps.filter(({ status }) => status !== "authorized").map(({ stepId, status }) => diagnostic("authorization", "warning", `${stepId} is ${status}.`, [stepId])));
      let preparedPlan = prepareExecutionPlan(plan, providerResolution, authorization);
      const policy = input.providerPolicy ?? new StableFirstAuthorizedProviderPolicy();
      const providerSelections = selectPreparedPlanProviders(preparedPlan, policy);
      preparedPlan = withProviderSelections(preparedPlan, providerSelections);
      log.append({ type: "provider_selection_completed", projectId: input.projectId, data: { policyId: policy.id, selections: Object.fromEntries(providerSelections.filter(({ providerId }) => providerId).map(({ stepId, providerId }) => [stepId, providerId])) } });
      diagnostics.push(...providerSelections.map(({ stepId, providerId, reason, status }) => diagnostic("policy", status === "selected" ? "info" : "warning", `${stepId}${providerId ? ` selected ${providerId}` : " was not selected"}: ${reason}`, [stepId, ...(providerId ? [providerId] : [])])));
      log.append({ type: "prepared_plan_created", projectId: input.projectId, data: { preparedPlanId: preparedPlan.id, status: preparedPlan.status, unresolvedRequirements: [...preparedPlan.unresolvedCapabilityIds, ...preparedPlan.unresolvedProviderStepIds], blockedStepIds: preparedPlan.blockedStepIds } });
      const unresolvedRequirements = [...resolution.unresolvedRequirements.map(({ id }) => id), ...preparedPlan.unresolvedCapabilityIds, ...preparedPlan.unresolvedProviderStepIds];
      const blockedRequirements = [...preparedPlan.blockedStepIds];
      const status: ShadowPipelineStatus = blockedRequirements.length ? "blocked" : unresolvedRequirements.length ? (plan.steps.length ? "partial" : "unresolved") : preparedPlan.status;
      if (status !== "ready") diagnostics.push(diagnostic("readiness", "warning", `Shadow plan is ${status}.`, [...unresolvedRequirements, ...blockedRequirements]));
      const events = log.list();
      return { runId, projectId: input.projectId, status, resolution, context, plan, providerResolution, authorization, providerSelections, preparedPlan, events, projectState: projectShadowProjectState(events), unresolvedRequirements: unique(unresolvedRequirements), blockedRequirements: unique(blockedRequirements), diagnostics };
    } catch (error) {
      if (!(error instanceof BilCompilationError)) throw error;
      const reasons = [...error.issues.map(({ reason }) => reason), ...error.conflicts.map(({ reason }) => reason)];
      diagnostics.push(diagnostic("compilation", "error", reasons.join("; "), error.issues.flatMap(({ moduleIds }) => moduleIds)));
      log.append({ type: "shadow_pipeline_failed", projectId: input.projectId, data: { stage: "compilation", reasons } });
      const events = log.list();
      return { runId, projectId: input.projectId, status: "failed", resolution, events, projectState: projectShadowProjectState(events), unresolvedRequirements: reasons, blockedRequirements: [], diagnostics };
    }
  }
}

function toResolutionInput(input: ShadowPipelineInput): BilResolutionInput { return { intents: [...(input.intent.actions ?? [])], concepts: [...(input.intent.objects ?? [])], relationships: input.projectContext?.relationships, requestedCapabilityIds: input.projectContext?.requestedCapabilityIds, availableCapabilityIds: input.projectContext?.availableCapabilityIds ?? input.capabilityRegistry.list().map(({ id }) => id), requestedOutputs: input.intent.desiredOutputs, constraints: input.intent.constraints, modality: input.projectContext?.modality, context: { ...(input.intent.context ?? {}), ...(input.projectContext?.values ?? {}) } }; }
function diagnostic(kind: ShadowDiagnosticKind, status: ShadowDiagnostic["status"], message: string, references: string[]): ShadowDiagnostic { return { kind, status, message, references: unique(references) }; }
function unique(items: string[]): string[] { return [...new Set(items)].sort(); }
function stableStringify(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`; return JSON.stringify(value); }
function hash(value: string): string { let result = 2166136261; for (let index = 0; index < value.length; index += 1) { result ^= value.charCodeAt(index); result = Math.imul(result, 16777619); } return (result >>> 0).toString(16).padStart(8, "0"); }
