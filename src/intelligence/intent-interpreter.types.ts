import {
  IntentInterpretationInput,
  IntelligenceCapabilitySummary,
  IntelligenceConstraint,
  IntentModality,
  RawUserIntent,
  StructuredIntent,
} from "./intelligence-provider.types";

/** The raw input Bikting accepts at the intelligence boundary. */
export type { RawUserIntent, IntentInterpretationInput };

/**
 * Intent interpretation is a proposal-producing boundary.
 *
 * Bikting validates everything a provider returns. The interpreter never translates a provider's
 * words into an action: it produces a StructuredIntent that the planner, provider resolver,
 * authorization layer, and execution kernel each get to re-check on their own terms.
 */
export interface IntentInterpretation {
  structuredIntent: StructuredIntent;
  providerId: string;
  requestId: string;
  /** Structured validation failures. An interpretation with errors never proceeds to planning. */
  issues: StructuredIntentIssue[];
  valid: boolean;
}

export type StructuredIntentIssueCode =
  | "missing_objective"
  | "unknown_intent_type"
  | "malformed_modality"
  | "malformed_concept"
  | "malformed_knowledge_need"
  | "malformed_constraint"
  | "malformed_capability_reference"
  | "provider_reported_issue"
  | "provider_output_malformed";

export interface StructuredIntentIssue {
  code: StructuredIntentIssueCode;
  message: string;
  reference?: string;
}

export interface IntentInterpreterOptions {
  /** Capability ids Bikting is willing to surface to the provider. */
  availableCapabilityIds?: readonly string[];
  capabilitySummaries?: readonly IntelligenceCapabilitySummary[];
  providerId?: string;
  maxConcepts?: number;
  maxKnowledgeNeeds?: number;
}

export interface IntentValidationOptions extends IntentInterpreterOptions {
  capabilitySummaries?: readonly IntelligenceCapabilitySummary[];
}

/** Compiles a canonical UserIntent-shaped record into the intelligence input contract. */
export function toRawUserIntent(input: {
  text: string;
  modality?: IntentModality;
  context?: Record<string, unknown>;
  constraints?: readonly IntelligenceConstraint[];
}): RawUserIntent {
  return {
    text: input.text,
    modality: input.modality ?? "text",
    context: input.context ? { ...input.context } : undefined,
    constraints: input.constraints ? input.constraints.map((item) => ({ ...item })) : undefined,
  };
}
