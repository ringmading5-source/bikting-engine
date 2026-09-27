import {
  IntelligenceCapabilities,
  IntelligenceProvider,
  IntelligenceRequest,
  IntentModality,
  IntentType,
  KnowledgeNeed,
  ReasoningResult,
  StructuredIntent,
  UncertaintyReport,
} from "./intelligence-provider.types";
import { freezeProviderCapabilities } from "./intelligence-provider.registry";
import { stableIdentity } from "./intelligence-identity";

/**
 * Deterministic mock intelligence provider.
 *
 * This is a test double, not an intelligence engine. It performs no language understanding: it
 * matches a caller-supplied fixture table and returns the declared structured output. Domain facts
 * such as "cells" or "biology" live in the fixtures the caller passes in, never in this file and
 * never in Bikting core. A real provider adapter would translate IntelligenceRequest into a
 * provider-specific prompt and return the same structured contracts.
 */
export interface IntentFixture {
  /** Exact raw text, or a predicate over the input. Used to select a fixture deterministically. */
  match: string | ((raw: { text?: string; modality: IntentModality }) => boolean);
  intentType: IntentType;
  objective: string;
  domain?: string;
  target?: string;
  concepts: readonly string[];
  relationships?: readonly { from: string; to: string; type?: string; required?: boolean }[];
  requestedOutputs?: readonly string[];
  possibleCapabilities?: readonly string[];
  knowledgeNeeds?: readonly KnowledgeNeed[];
  requestedDepth?: "overview" | "detailed" | "expert";
  uncertainty?: UncertaintyReport;
  /** When true, the fixture is selected but produces an explicit incomplete interpretation. */
  incomplete?: boolean;
}

export interface ReasoningFixture {
  /** Selects the reasoning fixture from the compiled request. */
  match: (request: IntelligenceRequest) => boolean;
  conclusions: readonly string[];
  proposedTasks?: readonly {
    purpose: string;
    capabilityId: string;
    dependsOn?: readonly string[];
    required?: boolean;
  }[];
  additionalKnowledgeNeeds?: readonly KnowledgeNeed[];
  outputRequirements?: readonly { type: string; required: boolean; capabilityId?: string; description?: string }[];
  evidenceConcepts?: readonly string[];
  evidenceRelationships?: readonly string[];
  uncertainty?: UncertaintyReport;
}

export interface MockIntelligenceProviderOptions {
  id?: string;
  name?: string;
  costTier?: IntelligenceCapabilities["costTier"];
  supportedTasks?: readonly IntelligenceCapabilities["tasks"][number][];
  intentFixtures?: readonly IntentFixture[];
  reasoningFixtures?: readonly ReasoningFixture[];
  /** Fixtures for the reasoning task when no reasoningFixture matches. Empty result means "no proposal". */
  defaultReasoningFixture?: ReasoningFixture;
}

export class MockIntelligenceProvider implements IntelligenceProvider {
  readonly id: string;
  readonly name: string;
  readonly capabilities: IntelligenceCapabilities;
  private readonly intentFixtures: readonly IntentFixture[];
  private readonly reasoningFixtures: readonly ReasoningFixture[];
  private readonly defaultReasoningFixture?: ReasoningFixture;
  /** Records every request so tests can assert what Bikting actually exposed to the provider. */
  readonly observedRequests: IntelligenceRequest[] = [];

  constructor(options: MockIntelligenceProviderOptions = {}) {
    this.id = options.id ?? "mock.deterministic";
    this.name = options.name ?? "Deterministic mock intelligence provider";
    this.capabilities = freezeProviderCapabilities({
      tasks: options.supportedTasks ?? ["interpret_intent", "reason", "plan", "summarize"],
      costTier: options.costTier ?? "free",
      supportsGrounding: true,
      supportsStructuredOutput: true,
      metadata: { deterministic: true, network: false },
    });
    this.intentFixtures = options.intentFixtures ?? [];
    this.reasoningFixtures = options.reasoningFixtures ?? [];
    this.defaultReasoningFixture = options.defaultReasoningFixture;
  }

  async interpretIntent(request: IntelligenceRequest): Promise<StructuredIntent> {
    this.observedRequests.push(structuredClone(request));
    const fixture = this.intentFixtures.find((candidate) => matchesIntentFixture(candidate, request));
    if (!fixture) return emptyIntent(request, "incomplete_interpretation", "No deterministic intent fixture matched the request.");
    return buildIntent(request, fixture);
  }

  async reason(request: IntelligenceRequest): Promise<ReasoningResult> {
    this.observedRequests.push(structuredClone(request));
    const fixture = this.reasoningFixtures.find((candidate) => candidate.match(request)) ?? this.defaultReasoningFixture;
    if (!fixture) return buildReasoning(request, { match: () => true, conclusions: [], proposedTasks: [] });
    return buildReasoning(request, fixture);
  }
}

function matchesIntentFixture(fixture: IntentFixture, request: IntelligenceRequest): boolean {
  const text = fixtureKey(request);
  if (typeof fixture.match !== "function") return text === fixture.match;
  return fixture.match({ text, modality: request.input?.modality ?? request.intent?.modality ?? "text" });
}

/** Deterministic key a fixture can match on: raw text when present, otherwise the compiled objective. */
function fixtureKey(request: IntelligenceRequest): string {
  if (typeof request.input?.text === "string" && request.input.text) return request.input.text;
  return request.objective;
}

function buildIntent(request: IntelligenceRequest, fixture: IntentFixture): StructuredIntent {
  const knowledgeNeeds = fixture.incomplete ? [] : (fixture.knowledgeNeeds ?? []);
  return {
    id: `intent-${stableIdentity({ requestId: request.id, fixture: fixture.objective })}`,
    modality: request.intent?.modality ?? "text",
    objective: fixture.objective,
    intentType: fixture.intentType,
    domain: fixture.domain,
    target: fixture.target,
    concepts: [...fixture.concepts],
    relationships: (fixture.relationships ?? []).map((relationship) => ({ ...relationship })),
    requestedOutputs: [...(fixture.requestedOutputs ?? [])],
    possibleCapabilities: [...(fixture.possibleCapabilities ?? [])],
    knowledgeNeeds: knowledgeNeeds.map((need) => ({ ...need })),
    constraints: [...(request.intent?.constraints ?? [])],
    requestedDepth: fixture.requestedDepth,
    uncertainty: fixture.incomplete
      ? { level: "high", reasons: ["The interpretation is incomplete."] }
      : fixture.uncertainty,
    providerId: request.provenance.callerId,
    issues: fixture.incomplete ? [{ type: "incomplete_interpretation", message: "The interpretation is incomplete." }] : undefined,
  };
}

function emptyIntent(request: IntelligenceRequest, type: "incomplete_interpretation" | "insufficient_context", message: string): StructuredIntent {
  return {
    id: `intent-${stableIdentity({ requestId: request.id, fallback: type })}`,
    modality: request.intent?.modality ?? "text",
    objective: request.objective,
    intentType: "unknown",
    concepts: [],
    relationships: [],
    requestedOutputs: [],
    possibleCapabilities: [],
    knowledgeNeeds: [],
    constraints: [...(request.intent?.constraints ?? [])],
    uncertainty: { level: "high", reasons: [message] },
    providerId: request.provenance.callerId,
    issues: [{ type, message }],
  };
}

function buildReasoning(request: IntelligenceRequest, fixture: ReasoningFixture): ReasoningResult {
  const knowledge = request.knowledgeContext;
  const availableConcepts = new Set((knowledge?.concepts ?? []).map(({ id }) => id));
  const availableRelationships = new Set((knowledge?.relationships ?? []).map(({ id }) => id));
  const evidenceReferences = [
    ...(fixture.evidenceConcepts ?? []).filter((id) => availableConcepts.has(id)).map((id) => ({ type: "knowledge_concept" as const, id })),
    ...(fixture.evidenceRelationships ?? []).filter((id) => availableRelationships.has(id)).map((id) => ({ type: "knowledge_relationship" as const, id })),
  ];
  const proposedTasks = (fixture.proposedTasks ?? []).map((task, index) => ({
    id: `task-${index + 1}-${stableIdentity({ capabilityId: task.capabilityId, purpose: task.purpose })}`,
    purpose: task.purpose,
    capabilityId: task.capabilityId,
    dependsOn: task.dependsOn ? [...task.dependsOn] : [],
    required: task.required ?? true,
  }));
  const requiredCapabilities = [...new Map(proposedTasks.map((task) => [task.capabilityId, { capabilityId: task.capabilityId, purpose: task.purpose, required: task.required ?? true }])).values()];
  return {
    id: `reasoning-${stableIdentity({ requestId: request.id, conclusions: fixture.conclusions, proposedTasks })}`,
    objective: request.objective,
    conclusions: [...fixture.conclusions],
    proposedTasks,
    requiredCapabilities,
    additionalKnowledgeNeeds: (fixture.additionalKnowledgeNeeds ?? []).map((need) => ({ ...need })),
    outputRequirements: (fixture.outputRequirements ?? []).map((requirement) => ({ ...requirement })),
    uncertainty: fixture.uncertainty,
    evidenceReferences,
    providerId: request.provenance.callerId,
  };
}
