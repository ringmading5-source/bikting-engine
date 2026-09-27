import {
  IntentInterpretationInput,
  IntelligenceCapabilitySummary,
  IntelligenceConstraint,
  IntelligenceRequest,
  KnowledgeNeed,
  RawUserIntent,
  StructuredIntent,
} from "./intelligence-provider.types";
import { IntelligenceProviderRegistry } from "./intelligence-provider.registry";
import { stableIdentity } from "./intelligence-identity";
import { knowledgeNeedsToRequirements } from "./intelligence-knowledge-needs";
import {
  IntentInterpretation,
  IntentInterpreterOptions,
  StructuredIntentIssue,
  StructuredIntentIssueCode,
} from "./intent-interpreter.types";

const intentTypes = new Set([
  "create", "learn", "explain", "analyze", "calculate", "compare", "transform", "automate", "unknown",
]);
const modalities = new Set(["text", "voice", "image", "file", "mixed"]);

/**
 * AI intent interpretation boundary.
 *
 * Bikting supplies raw, credential-free user input to a provider and receives a StructuredIntent
 * back. The provider may understand language; Bikting decides what the interpretation is allowed to
 * influence. Validation here is structural only — it rejects malformed structure and capability
 * references Bikting does not recognise. It performs no semantic judging and encodes no domain rules.
 */
export class IntentInterpreter {
  constructor(private readonly providers: IntelligenceProviderRegistry, private readonly options: IntentInterpreterOptions = {}) {}

  async interpret(input: IntentInterpretationInput, providerId?: string): Promise<IntentInterpretation> {
    assertRawIntent(input.raw);
    const provider = this.providers.resolveWithFallback("interpret_intent", providerId ?? this.options.providerId);
    const capabilitySummaries = this.capabilitySummaries(input.availableCapabilities);
    const request: IntelligenceRequest = {
      id: `intent-request-${stableIdentity({ raw: input.raw, capabilities: capabilitySummaries.map(({ id }) => id), previousIntents: input.previousIntents?.map(({ id }) => id) })}`,
      task: "interpret_intent",
      objective: input.raw.text?.trim() ? `Interpret the user's ${input.raw.modality} request.` : "Interpret the user's request.",
      input: { ...input.raw, context: undefined },
      concepts: [],
      constraints: (input.raw.constraints ?? []).map((item) => ({ ...item })),
      availableCapabilities: capabilitySummaries,
      requiredOutput: { fields: ["objective", "intentType", "domain", "concepts", "requestedOutputs", "possibleCapabilities", "knowledgeNeeds"], description: "A structured interpretation of the user's request." },
      provenance: { callerId: provider.id, sourceType: "user" },
      previousObservations: input.raw.previousObservations ? [...input.raw.previousObservations] : undefined,
    };
    const structured = await provider.interpretIntent(request);
    const issues = validateStructuredIntent(structured, capabilitySummaries, this.options);
    return {
      structuredIntent: freezeIntent(structured),
      providerId: provider.id,
      requestId: request.id,
      issues,
      valid: issues.length === 0,
    };
  }

  private capabilitySummaries(provided?: readonly IntelligenceCapabilitySummary[]): IntelligenceCapabilitySummary[] {
    if (provided?.length) return provided.map((item) => ({ ...item }));
    return (this.options.capabilitySummaries ?? []).map((item) => ({ ...item }));
  }
}

function assertRawIntent(raw: RawUserIntent): void {
  if (!raw || typeof raw !== "object") throw new TypeError("Raw user intent is required.");
  if (!modalities.has(raw.modality)) throw new TypeError(`Unsupported intent modality: ${String(raw.modality)}`);
  if (!raw.text?.trim() && !raw.context) throw new TypeError("Raw user intent requires text or context.");
}

export function validateStructuredIntent(
  intent: StructuredIntent,
  capabilities: readonly IntelligenceCapabilitySummary[],
  options: IntentInterpreterOptions = {},
): StructuredIntentIssue[] {
  const issues: StructuredIntentIssue[] = [];
  const add = (code: StructuredIntentIssueCode, message: string, reference?: string): void => {
    issues.push({ code, message, reference });
  };
  if (!intent || typeof intent !== "object") {
    add("provider_output_malformed", "The intelligence provider did not return a structured intent.");
    return issues;
  }
  if (typeof intent.objective !== "string" || !intent.objective.trim()) add("missing_objective", "A structured interpretation requires an objective.");
  if (!intentTypes.has(intent.intentType)) add("unknown_intent_type", `Unknown intent type: ${String(intent.intentType)}`, intent.intentType);
  if (!modalities.has(intent.modality)) add("malformed_modality", `Unsupported modality: ${String(intent.modality)}`, intent.modality);
  const maxConcepts = options.maxConcepts ?? 64;
  if (intent.concepts.length > maxConcepts) add("malformed_concept", `A structured interpretation may declare at most ${maxConcepts} concepts.`);
  for (const concept of intent.concepts) if (typeof concept !== "string" || !concept.trim()) add("malformed_concept", "Concepts must be non-empty strings.");
  const maxNeeds = options.maxKnowledgeNeeds ?? 32;
  if (intent.knowledgeNeeds.length > maxNeeds) add("malformed_knowledge_need", `A structured interpretation may declare at most ${maxNeeds} knowledge needs.`);
  for (const need of intent.knowledgeNeeds) {
    if (typeof need.topic !== "string" || !need.topic.trim()) add("malformed_knowledge_need", "A knowledge need requires a topic.", String(need.topic));
    if (need.freshness && !["stable", "recent", "live", "project_current"].includes(need.freshness)) add("malformed_knowledge_need", `Unsupported knowledge freshness: ${String(need.freshness)}`, need.topic);
  }
  for (const constraint of intent.constraints as readonly IntelligenceConstraint[]) {
    if (!constraint || typeof constraint.type !== "string" || !constraint.type.trim()) add("malformed_constraint", "A constraint requires a type.");
  }
  for (const capabilityId of intent.possibleCapabilities) {
    if (typeof capabilityId !== "string" || !capabilityId.trim()) { add("malformed_capability_reference", "Capability references must be non-empty strings."); continue; }
    if (capabilities.length && !capabilities.some(({ id }) => id === capabilityId)) {
      add("malformed_capability_reference", `The interpretation references a capability Bikting did not offer: ${capabilityId}`, capabilityId);
    }
  }
  for (const issue of intent.issues ?? []) add("provider_reported_issue", issue.message, issue.reference);
  return issues;
}

export { knowledgeNeedsToRequirements };

function freezeIntent(intent: StructuredIntent): StructuredIntent {
  return deepFreeze(structuredClone(intent));
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  return Object.freeze(value);
}
