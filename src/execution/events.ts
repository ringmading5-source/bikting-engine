export type ExecutionEventType =
  | "bil_resolution_started"
  | "bil_resolution_completed"
  | "bil_context_compiled"
  | "planning_started"
  | "planning_completed"
  | "provider_resolution_started"
  | "provider_resolution_completed"
  | "authorization_evaluated"
  | "prepared_plan_created"
  | "provider_selection_completed"
  | "shadow_pipeline_failed"
  | "execution_started"
  | "step_ready"
  | "step_started"
  | "input_bindings_resolved"
  | "provider_invoked"
  | "provider_completed"
  | "provider_failed"
  | "step_succeeded"
  | "step_failed"
  | "step_blocked"
  | "execution_completed"
  | "execution_failed"
  | "knowledge_resolution_started"
  | "knowledge_resolution_completed"
  | "knowledge_retrieval_started"
  | "knowledge_retrieval_completed"
  | "knowledge_context_created"
  | "knowledge_requirement_unresolved"
  | "knowledge_conflict_detected"
  | "concept_extraction_completed"
  | "relationship_requirement_created"
  | "knowledge_discovery_started"
  | "knowledge_discovery_round_started"
  | "relationship_discovered"
  | "knowledge_gap_detected"
  | "followup_knowledge_requirement_created"
  | "knowledge_discovery_round_completed"
  | "knowledge_sufficiency_evaluated"
  | "knowledge_discovery_completed"
  | "intent_received"
  | "knowledge_retrieved"
  | "plan_created"
  | "capability_required"
  | "provider_selected"
  | "authorization_required"
  | "authorization_granted"
  | "task_started"
  | "task_progress"
  | "task_completed"
  | "task_failed"
  | "observation_recorded"
  | "verification_started"
  | "verification_completed"
  | "artifact_created"
  | "project_completed";

/** An immutable description of an actual engine transition. */
export interface ExecutionEvent {
  id: string;
  type: ExecutionEventType;
  projectId: string;
  occurredAt: string;
  runId?: string;
  sequence?: number;
  correlationId?: string;
  causationId?: string;
  taskId?: string;
  executionAttemptId?: string;
  providerId?: string;
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}
