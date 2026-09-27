import type {
  IntelligenceRequest,
  KnowledgeNeed,
  ReasoningResult,
  StructuredIntent,
} from "./intelligence-provider.types";

/** Everything Bikting has compiled for a reasoning task. All members are optional; none are fabricated. */
export interface ReasoningContextInput {
  projectId?: string;
  intent?: StructuredIntent;
  bilContext?: import("../bil/bil.types").BilContext;
  knowledgeContext?: import("../knowledge/knowledge-context").KnowledgeContext;
  executionPlan?: import("../planning/plan.types").ExecutionPlan;
  availableCapabilities: readonly import("./intelligence-provider.types").IntelligenceCapabilitySummary[];
  constraints?: readonly import("./intelligence-provider.types").IntelligenceConstraint[];
  previousObservations?: readonly import("./intelligence-provider.types").ObservationReference[];
  projectState?: Record<string, unknown>;
  /** Knowledge Bikting looked for and could not obtain. Compiled as gaps, never as facts. */
  missingKnowledge?: readonly { requirementId: string; topic?: string; reason: string }[];
}

export type ReasoningStopReason =
  | "sufficient"
  | "no_new_knowledge_needs"
  | "knowledge_unresolvable"
  | "max_rounds_reached"
  | "provider_reported_insufficiency";

export interface ReasoningRound {
  round: number;
  requestId: string;
  providerId: string;
  /** Knowledge need ids Bikting issued for this round, after deduplication. */
  knowledgeRequirementIds: readonly string[];
  /** Requirement ids that remained unresolved after this round's retrieval. */
  unresolvedRequirementIds: readonly string[];
  addedConceptIds: readonly string[];
  addedRelationshipIds: readonly string[];
  addedKnowledgeNeedIds: readonly string[];
  /** True when the round changed the knowledge Bikting holds. No progress ends the loop. */
  progress: boolean;
  sufficient: boolean;
}

export interface ReasoningRunResult {
  /** The final validated proposal. Never an execution command. */
  reasoning: ReasoningResult;
  /** Every compiled request, in round order. Tests assert on these to prove what providers saw. */
  requests: readonly IntelligenceRequest[];
  rounds: readonly ReasoningRound[];
  stopReason: ReasoningStopReason;
  knowledgeContext?: import("../knowledge/knowledge-context").KnowledgeContext;
  knowledgeRequirements: readonly import("../knowledge/knowledge-requirement.types").KnowledgeRequirement[];
  artifacts: readonly import("../knowledge/knowledge-source.types").KnowledgeArtifact[];
  /** Issues found while validating the proposal. A proposal with errors never reaches planning. */
  issues: readonly ProposalIssue[];
  valid: boolean;
  providerId: string;
}

export type ProposalIssueCode =
  | "malformed_proposal"
  | "unknown_capability"
  | "unauthorized_capability"
  | "unknown_dependency"
  | "dependency_cycle"
  | "fabricated_evidence"
  | "malformed_binding"
  | "executable_binding"
  | "knowledge_need_malformed"
  | "objective_mismatch";

export interface ProposalIssue {
  code: ProposalIssueCode;
  message: string;
  reference?: string;
}

/** Reasoning budget. Small, deterministic, and explicit. */
export interface ReasoningBudget {
  maxRounds: number;
  maxKnowledgeRequirementsPerRound: number;
  maxTotalKnowledgeRequirements: number;
}

export const DEFAULT_REASONING_BUDGET: ReasoningBudget = Object.freeze({
  maxRounds: 3,
  maxKnowledgeRequirementsPerRound: 4,
  maxTotalKnowledgeRequirements: 8,
});

export type { KnowledgeNeed, ReasoningResult, StructuredIntent };
