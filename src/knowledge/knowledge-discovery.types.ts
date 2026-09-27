import type { KnowledgeConflict } from "./knowledge-context";
import { KnowledgeRequirement } from "./knowledge-requirement.types";
import { RelationshipRequirement } from "./relationship-discovery";

export type KnowledgeGapType = "missing_concept" | "unresolved_relationship" | "missing_evidence" | "freshness_mismatch" | "conflict" | "insufficient_coverage";
export interface KnowledgeGap { id: string; type: KnowledgeGapType; required: boolean; requirementId?: string; relationshipRequirementId?: string; conceptIds: string[]; relationshipTypes?: string[]; frontierConceptId?: string; reason: string; provenance: Array<{ sourceType: "intent" | "bil" | "resolution" | "context"; sourceId: string }>; }
export type KnowledgeSufficiencyStatus = "sufficient" | "partial" | "insufficient" | "conflicted";
export interface KnowledgeSufficiencyResult { status: KnowledgeSufficiencyStatus; sufficient: boolean; reasons: Array<{ code: string; referenceIds: string[]; message: string }>; requiredGapIds: string[]; optionalGapIds: string[]; conflictIds: string[]; }
export interface KnowledgeDiscoveryBudget { maxRounds: number; maxGeneratedRequirements: number; maxRetrievedArtifacts: number; maxDiscoveredConcepts: number; maxDiscoveredRelationships: number; }
export type KnowledgeDiscoveryStopReason = "sufficient" | "no_eligible_source" | "no_progress" | "budget_exhausted" | "optional_gaps_only" | "access_blocked" | "conflicted" | "not_required";
export interface DiscoveryRound { round: number; incomingRequirementIds: string[]; selectedSourceIds: string[]; retrievedArtifactIds: string[]; discoveredConceptIds: string[]; discoveredRelationshipIds: string[]; gapIds: string[]; generatedRequirementIds: string[]; progress: boolean; provenance: Array<{ sourceId: string; artifactIds: string[] }>; }
export interface KnowledgeDiscoveryHistory { rounds: DiscoveryRound[]; stopReason: KnowledgeDiscoveryStopReason; sufficiency: KnowledgeSufficiencyResult; generatedRequirements: KnowledgeRequirement[]; relationshipRequirements: RelationshipRequirement[]; conflicts: KnowledgeConflict[]; }
