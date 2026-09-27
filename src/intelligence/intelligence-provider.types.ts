/**
 * Canonical contracts for AI reasoning providers.
 *
 * Bikting thinks in structured contracts. Provider adapters think in model-specific prompts.
 * Nothing in core Bikting may branch on a provider name: swapping an OpenAI adapter for a local
 * model adapter must not change orchestration, validation, planning, or execution.
 *
 * This phase ships contracts, a registry, and deterministic mock adapters only. No remote model
 * API is implemented, and an intelligence provider never receives credentials, filesystem access,
 * shell access, or the ability to invoke a capability directly.
 */

/** Work an intelligence provider can be asked to do. Specialization is expressed as a task tag. */
export type IntelligenceTask =
  | "interpret_intent"
  | "reason"
  | "plan"
  | "code"
  | "summarize"
  | "classify"
  | "vision"
  | "voice";

/** Provider-declared strengths, used for routing before any provider-specific logic exists. */
export interface IntelligenceCapabilities {
  tasks: readonly IntelligenceTask[];
  /** Advisory, not authoritative: Bikting does not implement cost optimization yet. */
  costTier?: "free" | "low" | "medium" | "high";
  /** False for providers that must not be used for tasks marked as requiring grounding. */
  supportsGrounding?: boolean;
  supportsStructuredOutput?: boolean;
  metadata?: Record<string, unknown>;
}

/** Modality of the raw user input entering the intelligence boundary. */
export type IntentModality = "text" | "voice" | "image" | "file" | "mixed";

/** Everything Bikting knows about a user request before a model sees it. */
export interface RawUserIntent {
  /** Only text, transcript, or extracted content. Never credentials, tokens, or binary blobs. */
  text?: string;
  modality: IntentModality;
  /** Optional inert references (project ids, file names, image ids). Never file contents or paths with secrets. */
  context?: Record<string, unknown>;
  constraints?: readonly IntelligenceConstraint[];
  previousObservations?: readonly ObservationReference[];
}

/** A prior observed result the interpreter may consider, by reference only. */
export interface ObservationReference {
  taskId: string;
  observationId: string;
  capabilityId?: string;
  summary?: string;
}

export interface IntelligenceConstraint {
  type: string;
  value: unknown;
  required?: boolean;
}

/**
 * Structured output of intent interpretation. This is data Bikting can route on.
 * Every field is optional except the objective: a provider that cannot determine something says so
 * rather than inventing it.
 */
export interface StructuredIntent {
  id: string;
  modality: IntentModality;
  /** Canonical goal in Bikting's own words. Never empty. */
  objective: string;
  intentType: IntentType;
  domain?: string;
  target?: string;
  concepts: readonly string[];
  relationships: readonly StructuredIntentRelationship[];
  requestedOutputs: readonly string[];
  /** Capability ids the interpreter believes may be useful. Proposals only, never authorizations. */
  possibleCapabilities: readonly string[];
  /** Concepts Bikting must obtain evidence for before reasoning can proceed. */
  knowledgeNeeds: readonly KnowledgeNeed[];
  constraints: readonly IntelligenceConstraint[];
  requestedDepth?: "overview" | "detailed" | "expert";
  uncertainty?: UncertaintyReport;
  providerId: string;
  /** Set when the provider could not produce a well-formed interpretation. */
  issues?: readonly IntelligenceIssue[];
}

export type IntentType =
  | "create"
  | "learn"
  | "explain"
  | "analyze"
  | "calculate"
  | "compare"
  | "transform"
  | "automate"
  | "unknown";

export interface StructuredIntentRelationship {
  from: string;
  to: string;
  type?: string;
  required?: boolean;
}

export interface KnowledgeNeed {
  topic: string;
  domain?: string;
  conceptIds?: readonly string[];
  relationshipTypes?: readonly string[];
  freshness?: "stable" | "recent" | "live" | "project_current";
  required?: boolean;
}

/** Uncertainty is reported, never silently resolved. */
export interface UncertaintyReport {
  level: "low" | "medium" | "high";
  reasons: readonly string[];
  assumed?: readonly string[];
}

export type IntelligenceIssueType =
  | "malformed_request"
  | "unauthorized_capability_reference"
  | "unknown_capability"
  | "incomplete_interpretation"
  | "insufficient_context";

export interface IntelligenceIssue {
  type: IntelligenceIssueType;
  message: string;
  reference?: string;
}

/**
 * Canonical structured request. Adapters translate this into provider-specific messages; core code
 * never constructs prompts. The shape stays provider-neutral so a cheap interpreter model and an
 * expensive reasoning model can be routed independently (see IntelligenceTask).
 */
export interface IntelligenceRequest {
  id: string;
  task: IntelligenceTask;
  objective: string;
  /** Present for interpretation tasks: the raw, credential-free user input. */
  input?: RawUserIntent;
  intent?: StructuredIntent;
  concepts: readonly string[];
  /** Only knowledge Bikting has actually retrieved, with provenance. Never fabricated. */
  knowledgeContext?: IntelligenceKnowledgeContext;
  /** Canonical requirements Bikting already knows, so the model does not re-derive structure. */
  bil?: IntelligenceBilContext;
  constraints: readonly IntelligenceConstraint[];
  /** Capabilities Bikting is willing to consider. Anything else must be reported as a request. */
  availableCapabilities: readonly IntelligenceCapabilitySummary[];
  requiredOutput: IntelligenceOutputContract;
  /** Who is responsible for this request, so proposals can be traced. */
  provenance: IntelligenceProvenance;
  /** Prior observed results, by reference only. */
  previousObservations?: readonly ObservationReference[];
}

export interface IntelligenceCapabilitySummary {
  id: string;
  description?: string;
  inputs?: readonly string[];
  outputs?: readonly string[];
  /** Present only when the capability needs authority Bikting has not granted. */
  accessRequirement?: string;
}

export interface IntelligenceKnowledgeContext {
  knowledgeContextId?: string;
  /**
   * Every concept Bikting actually retrieved for the active requirements. Retrieved evidence is not
   * discarded because the interpretation did not name it: reasoning over a retrieved graph needs
   * the surrounding concepts too.
   */
  concepts: readonly IntelligenceKnowledgeConcept[];
  /** The subset the interpretation explicitly asked about. Recorded, not used to prune. */
  focusConceptIds: readonly string[];
  relationships: readonly IntelligenceRelationship[];
  facts: readonly IntelligenceFact[];
  /** Requirement ids Bikting could not satisfy. Present means "missing", never "invented". */
  unresolvedRequirementIds: readonly string[];
  conflicts: readonly IntelligenceConflict[];
  sourceIds: readonly string[];
}

export interface IntelligenceKnowledgeConcept {
  id: string;
  name?: string;
  definition?: string;
  explanation?: string;
  examples?: readonly string[];
  prerequisites?: readonly string[];
  sourceIds?: readonly string[];
}

export interface IntelligenceRelationship {
  id: string;
  type: string;
  from: string;
  to: string;
  evidenceReference?: string;
}

export interface IntelligenceFact {
  subject: string;
  predicate?: string;
  value: unknown;
  sourceId?: string;
  evidenceReference?: string;
}

export interface IntelligenceConflict {
  id: string;
  subject: string;
  candidateValues: readonly { value: unknown; sourceId: string }[];
}

export interface IntelligenceBilContext {
  contextId: string;
  sourceModules: readonly { id: string; version: string }[];
  requiredCapabilityIds: readonly string[];
  knowledgeRequirementIds: readonly string[];
  constraints: readonly IntelligenceConstraint[];
  verificationMethods: readonly string[];
  outputTypes: readonly string[];
}

export interface IntelligenceOutputContract {
  /** Field names Bikting requires back. The provider adapter owns the wire format. */
  fields: readonly string[];
  description?: string;
}

export interface IntelligenceProvenance {
  projectId?: string;
  callerId: string;
  parentRequestId?: string;
  sourceType: "user" | "engine" | "knowledge" | "plan" | "observation";
  sourceId?: string;
}

/** Task proposal emitted by reasoning. A proposal is not authorization and not an execution command. */
export interface ProposedTask {
  id: string;
  purpose: string;
  capabilityId: string;
  dependsOn?: readonly string[];
  /** Binds plan inputs to upstream outputs or intent values. Never executable content. */
  bindings?: readonly ProposedBinding[];
  required?: boolean;
}

export interface ProposedBinding {
  target: string;
  sourceType: "intent" | "context" | "task_output" | "literal";
  path?: readonly string[];
  taskId?: string;
  value?: unknown;
}

export interface RequiredCapability {
  capabilityId: string;
  purpose?: string;
  required?: boolean;
}

/**
 * Reasoning output. Treated as untrusted structured input: it is validated against the registered
 * capability catalogue and Bikting's authorization before it can influence a plan.
 */
export interface ReasoningResult {
  id: string;
  objective: string;
  conclusions: readonly string[];
  proposedTasks: readonly ProposedTask[];
  requiredCapabilities: readonly RequiredCapability[];
  additionalKnowledgeNeeds: readonly KnowledgeNeed[];
  outputRequirements: readonly OutputRequirement[];
  uncertainty?: UncertaintyReport;
  /** Evidence the model claims to have used. Bikting checks each id against retrieved artifacts. */
  evidenceReferences: readonly EvidenceReference[];
  providerId: string;
  issues?: readonly IntelligenceIssue[];
}

export interface OutputRequirement {
  type: string;
  required: boolean;
  capabilityId?: string;
  description?: string;
}

export interface EvidenceReference {
  type: "knowledge_concept" | "knowledge_relationship" | "knowledge_fact" | "knowledge_context";
  id: string;
  sourceIds?: readonly string[];
}

/** The provider boundary. Implementations may be remote in future; this phase is mock-only. */
export interface IntelligenceProvider {
  readonly id: string;
  readonly name: string;
  readonly capabilities: IntelligenceCapabilities;
  interpretIntent(request: IntelligenceRequest): Promise<StructuredIntent>;
  reason(request: IntelligenceRequest): Promise<ReasoningResult>;
}

/** An intelligence provider must never be handed Bikting's execution machinery. */
export type ForbiddenIntelligenceDependency =
  | "capability_execution"
  | "provider_invocation"
  | "credential_selection"
  | "filesystem_access"
  | "shell_access"
  | "network_access";

export interface IntelligenceSafetyProfile {
  providerId: string;
  /** Structurally enforced: providers receive this shape, never Bikting internals. */
  receivesCredentials: false;
  receivesFilesystem: false;
  receivesShell: false;
  receivesNetwork: false;
  forbidden: readonly ForbiddenIntelligenceDependency[];
}

export interface IntentInterpretationInput {
  raw: RawUserIntent;
  /** Capabilities Bikting is willing to consider, compiled into summaries. */
  availableCapabilities: readonly IntelligenceCapabilitySummary[];
  /** Optional previous interpretations, by reference, for continuity across turns. */
  previousIntents?: readonly StructuredIntent[];
  context?: Record<string, unknown>;
}
