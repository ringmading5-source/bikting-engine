import { Relationship } from "../core/types";
import { RelationshipTypeDefinition } from "../core/relationship.registry";
import { UserIntent } from "../intent/intent.types";
import { Capability } from "../capabilities/capability.types";
import { KnowledgeConcept, KnowledgeModule } from "../knowledge/knowledge.types";
import { BiktingGraph } from "../core/graph";
import { PlanInputBinding } from "../planning/input-binding.types";
import { KnowledgeRequirement } from "../knowledge/knowledge-requirement.types";

export type BilModuleKind = "reasoning" | "knowledge" | "capability" | "workflow" | "output" | "constraint";

export interface BilApplicability {
  intents?: string[];
  allConcepts?: string[];
  anyConcepts?: string[];
  allRequestedCapabilities?: string[];
  anyRequestedCapabilities?: string[];
  allRequestedOutputs?: string[];
  anyRequestedOutputs?: string[];
  modalities?: string[];
  contextEquals?: Record<string, string | number | boolean | null>;
  relationships?: Array<Pick<Relationship, "type"> & Partial<Pick<Relationship, "from" | "to">>>;
}

export interface BilConceptDeclaration {
  id: string;
  name?: string;
  description?: string;
}

export interface BilReasoningStrategy {
  id: string;
  type: "deterministic" | "model_assisted" | "retrieve_then_reason";
  description?: string;
  requiredContext?: string[];
}

export interface BilCapabilityRequirement {
  capabilityId: string;
  required: boolean;
  purpose?: string;
}

export interface BilWorkflowStep {
  id: string;
  capabilityId: string;
  dependsOn?: string[];
  description?: string;
  inputBindings?: PlanInputBinding[];
}

export interface BilWorkflow {
  id: string;
  steps: BilWorkflowStep[];
}

export interface BilExecutionRequirement {
  id: string;
  type: string;
  value?: string | number | boolean | string[];
  required?: boolean;
}

export interface BilVerificationRequirement {
  id: string;
  method: string;
  capabilityId?: string;
  required: boolean;
  description?: string;
}

export interface BilOutputRequirement {
  id: string;
  type: string;
  capabilityId?: string;
  required: boolean;
}

export interface BilModuleReference {
  moduleId: string;
  version: string;
}

export interface BilModule {
  id: string;
  version: string;
  kind: BilModuleKind;
  name: string;
  description: string;
  appliesWhen: BilApplicability;
  intents: string[];
  concepts: BilConceptDeclaration[];
  relationships: Relationship[];
  reasoningStrategies: BilReasoningStrategy[];
  capabilityRequirements: BilCapabilityRequirement[];
  knowledgeRequirements: KnowledgeRequirement[];
  workflow?: BilWorkflow;
  constraints: NonNullable<UserIntent["constraints"]>;
  executionRequirements: BilExecutionRequirement[];
  verificationRequirements: BilVerificationRequirement[];
  outputRequirements: BilOutputRequirement[];
  moduleReferences?: BilModuleReference[];
  metadata?: Record<string, unknown>;
}

export interface BilResolutionInput {
  intents: string[];
  concepts?: string[];
  relationships?: Relationship[];
  requestedCapabilityIds?: string[];
  availableCapabilityIds?: string[];
  requestedOutputs?: string[];
  constraints?: NonNullable<UserIntent["constraints"]>;
  modality?: string;
  context?: Record<string, unknown>;
}

export interface BilModuleSelection {
  moduleId: string;
  version: string;
  reasons: string[];
}

export interface BilUnresolvedRequirement {
  kind: "capability" | "output";
  id: string;
  reason: string;
}

export interface BilResolution {
  id: string;
  selectedModuleIds: string[];
  selectedModuleVersions: Array<{ moduleId: string; version: string }>;
  selections: BilModuleSelection[];
  requiredCapabilityIds: string[];
  relevantRelationships: Relationship[];
  constraints: NonNullable<UserIntent["constraints"]>;
  executionRequirements: BilExecutionRequirement[];
  verificationRequirements: BilVerificationRequirement[];
  outputRequirements: BilOutputRequirement[];
  unresolvedRequirements: BilUnresolvedRequirement[];
}

export interface BilProvenance {
  moduleId: string;
  moduleVersion: string;
  category: "concept" | "relationship" | "reasoning_strategy" | "capability_requirement" | "knowledge_requirement" | "workflow" | "workflow_step" | "constraint" | "execution_requirement" | "verification_requirement" | "output_requirement" | "module_reference";
  declarationId?: string;
}

export interface BilCompiledRequirement<T> {
  readonly declaration: Readonly<T>;
  readonly provenance: readonly BilProvenance[];
}

export interface BilCompiledCapabilityRequirement extends BilCompiledRequirement<BilCapabilityRequirement> {
  readonly capability?: Readonly<Capability>;
}

export interface BilCompiledWorkflowStep extends Readonly<BilWorkflowStep> {
  readonly provenance: readonly BilProvenance[];
}

export interface BilCompiledWorkflow {
  readonly id: string;
  readonly steps: readonly BilCompiledWorkflowStep[];
  readonly provenance: readonly BilProvenance[];
}

export type BilCompilationIssueType = "unknown_capability" | "missing_module" | "invalid_version" | "incompatible_version" | "circular_module_dependency" | "unknown_relationship_type" | "invalid_concept_reference" | "missing_workflow_capability";
export interface BilCompilationIssue {
  type: BilCompilationIssueType;
  moduleIds: string[];
  reference?: string;
  reason: string;
}

export type BilConflictType = "constraint" | "capability_requirement" | "knowledge_requirement" | "workflow" | "concept" | "relationship" | "output_requirement";
export interface BilConflict {
  type: BilConflictType;
  modules: Array<{ id: string; version: string }>;
  declarations: unknown[];
  reason: string;
}

export interface BilContext {
  readonly id: string;
  readonly resolutionId: string;
  readonly intent: Readonly<UserIntent>;
  readonly sourceModules: readonly Readonly<{ id: string; version: string }>[];
  readonly concepts: readonly Readonly<KnowledgeConcept>[];
  readonly relationships: readonly Readonly<Relationship>[];
  readonly relationshipTypes: readonly Readonly<RelationshipTypeDefinition>[];
  readonly knowledgeModules: readonly Readonly<KnowledgeModule>[];
  readonly graph: BiktingGraph;
  readonly reasoningStrategies: readonly BilCompiledRequirement<BilReasoningStrategy>[];
  readonly requiredCapabilityIds: readonly string[];
  readonly capabilities: readonly Readonly<Capability>[];
  readonly capabilityRequirements: readonly BilCompiledCapabilityRequirement[];
  readonly knowledgeRequirements: readonly BilCompiledRequirement<KnowledgeRequirement>[];
  readonly workflows: readonly BilCompiledWorkflow[];
  readonly constraints: readonly BilCompiledRequirement<NonNullable<UserIntent["constraints"]>[number]>[];
  readonly executionRequirements: readonly BilCompiledRequirement<BilExecutionRequirement>[];
  readonly verificationRequirements: readonly BilCompiledRequirement<BilVerificationRequirement>[];
  readonly outputRequirements: readonly BilCompiledRequirement<BilOutputRequirement>[];
  readonly unresolvedReferences: readonly BilCompilationIssue[];
  readonly provenance: readonly BilProvenance[];
}
