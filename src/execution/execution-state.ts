import { ExecutionEvent } from "./events";

export type CanonicalStepState = "pending" | "ready" | "running" | "succeeded" | "verified" | "failed" | "blocked" | "skipped";
export interface CanonicalExecutionState { runId: string; planId: string; phase: "executing" | "completed" | "failed"; status: "running" | "completed" | "failed" | "blocked"; steps: Record<string, CanonicalStepState>; completedStepIds: string[]; failedStepIds: string[]; blockedStepIds: string[]; observationIds: string[]; verificationStatuses: Record<string, string>; lastSequence: number; }

export function projectCanonicalExecutionState(events: readonly ExecutionEvent[]): CanonicalExecutionState {
  const ordered = [...events].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)); const first = ordered[0];
  const state: CanonicalExecutionState = { runId: first?.runId ?? "", planId: "", phase: "executing", status: "running", steps: {}, completedStepIds: [], failedStepIds: [], blockedStepIds: [], observationIds: [], verificationStatuses: {}, lastSequence: 0 };
  for (const event of ordered) { state.lastSequence = event.sequence ?? state.lastSequence; const id = event.taskId; const data = event.data ?? {}; if (typeof data.planId === "string") state.planId = data.planId;
    if (event.type === "step_ready" && id) transition(state, id, "ready");
    else if (event.type === "step_started" && id) transition(state, id, "running");
    else if (event.type === "step_succeeded" && id) { transition(state, id, data.verified === true ? "verified" : "succeeded"); state.completedStepIds.push(id); }
    else if (event.type === "step_failed" && id) { transition(state, id, "failed"); state.failedStepIds.push(id); }
    else if (event.type === "step_blocked" && id) { transition(state, id, "blocked"); state.blockedStepIds.push(id); }
    else if (event.type === "observation_recorded" && typeof data.observationId === "string") state.observationIds.push(data.observationId);
    else if (event.type === "verification_completed" && typeof data.verificationId === "string" && typeof data.status === "string") state.verificationStatuses[data.verificationId] = data.status;
    else if (event.type === "execution_completed") { state.phase = "completed"; state.status = "completed"; }
    else if (event.type === "execution_failed") { state.phase = "failed"; state.status = state.blockedStepIds.length && !state.failedStepIds.length ? "blocked" : "failed"; }
  }
  state.completedStepIds = unique(state.completedStepIds); state.failedStepIds = unique(state.failedStepIds); state.blockedStepIds = unique(state.blockedStepIds); state.observationIds = unique(state.observationIds); return state;
}
const allowed: Record<CanonicalStepState, CanonicalStepState[]> = { pending: ["ready", "blocked"], ready: ["running", "blocked"], running: ["succeeded", "verified", "failed"], succeeded: ["verified", "failed"], verified: [], failed: [], blocked: [], skipped: [] };
function transition(state: CanonicalExecutionState, id: string, next: CanonicalStepState): void { const current = state.steps[id] ?? "pending"; if (!allowed[current].includes(next)) throw new Error(`Invalid execution state transition ${current} -> ${next} for ${id}.`); state.steps[id] = next; }
function unique(values: string[]): string[] { return [...new Set(values)]; }
