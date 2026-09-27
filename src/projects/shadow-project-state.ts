import { ExecutionEvent } from "../execution/events";

export type ShadowProjectPhase = "accepted" | "resolving" | "compiled" | "planning" | "providers" | "authorized" | "prepared" | "failed";
export interface ShadowProjectState {
  projectId: string;
  runId: string;
  phase: ShadowProjectPhase;
  intentAccepted: boolean;
  selectedBilModuleIds: string[];
  bilContextId?: string;
  planId?: string;
  providerResolutionStatus?: "resolved" | "partial" | "unresolved";
  authorizationStatus?: "authorized" | "blocked" | "unresolved";
  preparedPlanStatus?: "ready" | "partial" | "blocked" | "unresolved";
  unresolvedRequirements: string[];
  blockedStepIds: string[];
  providerSelections: Record<string, string>;
  lastSequence: number;
}

/** Pure event projector. Replaying the same ordered events yields the same state. */
export function projectShadowProjectState(events: readonly ExecutionEvent[]): ShadowProjectState {
  const ordered = [...events].sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
  const first = ordered[0];
  const state: ShadowProjectState = { projectId: first?.projectId ?? "", runId: first?.runId ?? "", phase: "accepted", intentAccepted: false, selectedBilModuleIds: [], unresolvedRequirements: [], blockedStepIds: [], providerSelections: {}, lastSequence: 0 };
  for (const event of ordered) {
    state.lastSequence = event.sequence ?? state.lastSequence;
    const data = event.data ?? {};
    switch (event.type) {
      case "intent_received": state.intentAccepted = true; state.phase = "accepted"; break;
      case "bil_resolution_started": state.phase = "resolving"; break;
      case "bil_resolution_completed": state.selectedBilModuleIds = strings(data.selectedModuleIds); state.unresolvedRequirements = strings(data.unresolvedRequirements); break;
      case "bil_context_compiled": state.bilContextId = string(data.contextId); state.phase = "compiled"; break;
      case "planning_started": state.phase = "planning"; break;
      case "planning_completed": state.planId = string(data.planId); break;
      case "provider_resolution_started": state.phase = "providers"; break;
      case "provider_resolution_completed": state.providerResolutionStatus = status(data.status, ["resolved", "partial", "unresolved"]); state.unresolvedRequirements = unique([...state.unresolvedRequirements, ...strings(data.unresolvedStepIds)]); break;
      case "authorization_evaluated": state.authorizationStatus = status(data.status, ["authorized", "blocked", "unresolved"]); state.blockedStepIds = strings(data.blockedStepIds); state.phase = "authorized"; break;
      case "provider_selection_completed": state.providerSelections = record(data.selections); break;
      case "prepared_plan_created": state.preparedPlanStatus = status(data.status, ["ready", "partial", "blocked", "unresolved"]); state.unresolvedRequirements = unique([...state.unresolvedRequirements, ...strings(data.unresolvedRequirements)]); state.blockedStepIds = unique([...state.blockedStepIds, ...strings(data.blockedStepIds)]); state.phase = "prepared"; break;
      case "shadow_pipeline_failed": state.phase = "failed"; state.unresolvedRequirements = [...state.unresolvedRequirements, ...strings(data.reasons)]; break;
    }
  }
  return state;
}

export class InMemoryShadowProjectRepository {
  private readonly states = new Map<string, ShadowProjectState>();
  project(events: readonly ExecutionEvent[]): ShadowProjectState { const state = projectShadowProjectState(events); this.states.set(state.projectId, structuredClone(state)); return state; }
  get(projectId: string): ShadowProjectState | undefined { const state = this.states.get(projectId); return state && structuredClone(state); }
}

function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function string(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function status<T extends string>(value: unknown, allowed: readonly T[]): T | undefined { return typeof value === "string" && allowed.includes(value as T) ? value as T : undefined; }
function record(value: unknown): Record<string, string> { if (!value || typeof value !== "object" || Array.isArray(value)) return {}; return Object.fromEntries(Object.entries(value).filter((item): item is [string, string] => typeof item[1] === "string")); }
function unique(items: string[]): string[] { return [...new Set(items)].sort(); }
