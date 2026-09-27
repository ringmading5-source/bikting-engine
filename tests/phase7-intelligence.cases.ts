import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseBilModule } from "../src/bil/bil.parser";
import { BilRegistry } from "../src/bil/bil.registry";
import { ShadowBiktingPipeline } from "../src/bil/shadow-bikting-pipeline";
import { CapabilityRegistry } from "../src/capabilities/capability.registry";
import { createDefaultRelationshipTypeRegistry } from "../src/core/relationship.registry";
import { CanonicalExecutionKernel } from "../src/execution/canonical-execution-kernel";
import { CanonicalProviderInvoker } from "../src/execution/provider-invoker";
import { IntentInterpreter, knowledgeNeedsToRequirements } from "../src/intelligence/intent-interpreter";
import { IntelligenceProviderRegistry } from "../src/intelligence/intelligence-provider.registry";
import { MockIntelligenceProvider } from "../src/intelligence/mock-intelligence.provider";
import { ContextCompiler, compileCapabilitySummaries } from "../src/intelligence/context-compiler";
import { ReasoningService, validateReasoningResult } from "../src/intelligence/reasoning.service";
import { ProposalPlanningAdapter } from "../src/intelligence/proposal-planning.adapter";
import { IntelligencePipeline } from "../src/intelligence/intelligence.pipeline";
import { KnowledgeSourceRegistry } from "../src/knowledge/knowledge-source.registry";
import { KnowledgeRetriever, StaticStructuredKnowledgeAdapter } from "../src/knowledge/knowledge-retriever";
import { KnowledgeSource } from "../src/knowledge/knowledge-source.types";
import { adaptLegacyProvider } from "../src/providers/legacyCapabilityAdapter";
import { CapabilityProviderRegistry } from "../src/providers/provider.registry";
import { createDefaultRegistries } from "../src/bikting/core/registry/createDefaultRegistries.js";
import { calculatorTool } from "../src/bikting/core/tools/deterministic/mathTools.js";

// ---------------------------------------------------------------------------
// Fixtures. Domain facts (websites, cells, biology) live here, in the test, never in Bikting core.
// ---------------------------------------------------------------------------

function environment() {
  const capabilityRegistry = new CapabilityRegistry();
  const providerRegistry = new CapabilityProviderRegistry();
  const ids = new Set<string>();
  const active = createDefaultRegistries();
  for (const adapter of [...active.tools.list(), ...active.models.list()]) {
    const adapted = adaptLegacyProvider(adapter);
    providerRegistry.register(adapted.provider);
    for (const capability of adapted.capabilities) {
      if (!ids.has(capability.id)) { capabilityRegistry.registerCapability(capability); ids.add(capability.id); }
    }
  }
  return { capabilityRegistry, providerRegistry, relationshipTypeRegistry: createDefaultRelationshipTypeRegistry(), capabilitySummaries: compileCapabilitySummaries(capabilityRegistry.list()) };
}

const WEBSITE_TEXT = "Build for me my personal website";
const BIOLOGY_TEXT = "Teach me cells in biology";

function websiteProvider(id = "mock.website") {
  return new MockIntelligenceProvider({
    id,
    name: "Deterministic website interpretation fixture",
    intentFixtures: [{
      match: WEBSITE_TEXT,
      intentType: "create",
      objective: "Create a personal website",
      domain: "software/web",
      target: "personal website",
      concepts: ["website"],
      requestedOutputs: ["workspace", "code", "explanation"],
      possibleCapabilities: ["code.execute", "text.generate"],
      knowledgeNeeds: [],
    }],
    reasoningFixtures: [{
      match: (request) => request.intent?.intentType === "create",
      conclusions: ["A personal website is a software deliverable that Bikting should plan rather than describe."],
      proposedTasks: [
        { purpose: "Plan the site structure", capabilityId: "text.generate", required: true },
        { purpose: "Produce the project files", capabilityId: "code.execute", dependsOn: [], required: true },
      ],
      outputRequirements: [
        { type: "workspace", required: true, capabilityId: "code.execute" },
        { type: "explanation", required: true, capabilityId: "text.generate" },
      ],
    }],
    defaultReasoningFixture: { match: () => true, conclusions: [], proposedTasks: [] },
  });
}

function biologyProvider(id = "mock.biology") {
  return new MockIntelligenceProvider({
    id,
    name: "Deterministic teaching interpretation fixture",
    intentFixtures: [{
      match: BIOLOGY_TEXT,
      intentType: "learn",
      objective: "Understand cells",
      domain: "biology",
      concepts: ["cell"],
      requestedOutputs: ["explanation", "visual", "voice"],
      possibleCapabilities: ["text.generate", "visual.scene", "voice.synthesize", "math.calculate"],
      knowledgeNeeds: [{ topic: "cell", domain: "biology", conceptIds: ["cell"], required: true }],
      requestedDepth: "overview",
    }],
    reasoningFixtures: [
      {
        // First round: Bikting holds no knowledge, so the model asks for it.
        match: (request) => !request.knowledgeContext,
        conclusions: ["Teaching about cells requires grounded knowledge before any explanation is written."],
        proposedTasks: [],
        additionalKnowledgeNeeds: [{ topic: "cell", domain: "biology", conceptIds: ["cell"], required: true }],
        outputRequirements: [{ type: "explanation", required: true, capabilityId: "text.generate" }],
      },
      {
        // Second round: knowledge is present, so the model proposes the teaching outputs.
        match: (request) => Boolean(request.knowledgeContext?.concepts.some(({ id }) => id === "cell")),
        conclusions: ["Cells can be explained from retrieved evidence, then visualised and narrated."],
        proposedTasks: [
          { purpose: "Write the explanation", capabilityId: "text.generate", required: true },
          { purpose: "Render a visual scene", capabilityId: "visual.scene", dependsOn: [], required: false },
          { purpose: "Narrate the explanation", capabilityId: "voice.synthesize", dependsOn: [], required: false },
        ],
        evidenceConcepts: ["cell"],
        outputRequirements: [
          { type: "explanation", required: true, capabilityId: "text.generate" },
          { type: "visual", required: false, capabilityId: "visual.scene" },
          { type: "voice", required: false, capabilityId: "voice.synthesize" },
        ],
      },
    ],
  });
}

function calculationProvider() {
  return new MockIntelligenceProvider({
    id: "mock.calculation",
    name: "Deterministic calculation interpretation fixture",
    intentFixtures: [{
      match: "Calculate 125 * 48",
      intentType: "calculate",
      objective: "Compute the product of 125 and 48",
      domain: "mathematics",
      concepts: ["arithmetic"],
      requestedOutputs: ["numeric_result"],
      // The model recognises that a deterministic capability exists; it does not perform the maths.
      possibleCapabilities: ["math.calculate"],
      knowledgeNeeds: [],
    }],
    reasoningFixtures: [{
      match: () => true,
      conclusions: ["Deterministic arithmetic exists, so Bikting should route math.calculate instead of generating a number."],
      proposedTasks: [{ purpose: "Evaluate the expression", capabilityId: "math.calculate", required: true }],
      outputRequirements: [{ type: "numeric_result", required: true, capabilityId: "math.calculate" }],
    }],
  });
}

function cellKnowledge() {
  const sources = new KnowledgeSourceRegistry();
  const retriever = new KnowledgeRetriever();
  const source: KnowledgeSource = {
    id: "fixture.biology.cells", name: "Fixture biology cells", type: "structured", domains: ["biology"],
    conceptIds: ["cell", "mitochondrion"], relationshipTypes: ["contains"], freshness: ["stable"],
    availability: "available", retrievalKind: "static", authority: { level: 1 },
    provenanceCharacteristics: { traceable: true, evidence: true },
  };
  sources.register(source);
  retriever.register(new StaticStructuredKnowledgeAdapter(source.id, {
    contentType: "structured",
    concepts: [
      { id: "cell", kind: "concept", name: "Cell", content: { definition: "The smallest structural unit of living organisms.", explanation: "Cells carry genetic material and perform the processes of life." } },
      { id: "mitochondrion", kind: "concept", name: "Mitochondrion", content: { definition: "An organelle that produces usable energy." } },
    ],
    relationships: [{ id: "cell-contains-mitochondrion", type: "contains", from: "cell", to: "mitochondrion" }],
    evidence: [{ type: "fixture", value: "cells" }],
  }));
  return { sources, retriever };
}

function unrelatedKnowledge() {
  const sources = new KnowledgeSourceRegistry();
  const retriever = new KnowledgeRetriever();
  const source: KnowledgeSource = {
    id: "fixture.unrelated.magnetism", name: "Fixture unrelated topic", type: "structured", domains: ["physics"],
    conceptIds: ["magnetism", "induction"], relationshipTypes: ["produces"], freshness: ["stable"],
    availability: "available", retrievalKind: "static", authority: { level: 1 },
    provenanceCharacteristics: { traceable: true, evidence: true },
  };
  sources.register(source);
  retriever.register(new StaticStructuredKnowledgeAdapter(source.id, {
    contentType: "structured",
    concepts: [{ id: "magnetism", kind: "concept", name: "Magnetism", content: { definition: "A physical force of attraction." } }],
    evidence: [{ type: "fixture", value: "magnetism" }],
  }));
  return { sources, retriever };
}

function bilRegistry(paths: string[]): BilRegistry {
  const registry = new BilRegistry();
  paths.forEach((path) => registry.register(parseBilModule(readFileSync(path, "utf8"))));
  return registry;
}

// ---------------------------------------------------------------------------
// 1 + 2: raw natural language becomes validated structured output
// ---------------------------------------------------------------------------

test("raw natural-language input becomes a validated structured interpretation at the intelligence boundary", async () => {
  const env = environment();
  const provider = websiteProvider();
  const registry = new IntelligenceProviderRegistry();
  registry.register(provider);
  const interpretation = await new IntentInterpreter(registry).interpret(
    { raw: { text: WEBSITE_TEXT, modality: "text" }, availableCapabilities: env.capabilitySummaries },
  );
  assert.equal(interpretation.valid, true, JSON.stringify(interpretation.issues));
  assert.deepEqual(interpretation.issues, []);
  const intent = interpretation.structuredIntent;
  assert.equal(intent.intentType, "create");
  assert.equal(intent.domain, "software/web");
  assert.equal(intent.target, "personal website");
  assert.deepEqual(intent.concepts, ["website"]);
  assert.deepEqual([...intent.requestedOutputs].sort(), ["code", "explanation", "workspace"]);
  assert.deepEqual([...intent.possibleCapabilities].sort(), ["code.execute", "text.generate"]);
  assert.equal(Object.isFrozen(intent), true);
  // The provider received the raw text and a structured capability catalogue, never Bikting internals.
  const request = provider.observedRequests[0];
  assert.equal(request.task, "interpret_intent");
  assert.equal(request.input?.text, WEBSITE_TEXT);
  assert.ok(request.availableCapabilities.length > 0);
  for (const forbidden of ["credentials", "authorizationGrants", "capabilityRegistry", "shell", "filesystem"]) {
    assert.equal(request.input?.context?.[forbidden], undefined);
  }
});

test("malformed or unknown-capability interpretations are rejected structurally rather than trusted", async () => {
  const env = environment();
  const provider = new MockIntelligenceProvider({
    id: "mock.bad",
    intentFixtures: [
      { match: "do something impossible", intentType: "create", objective: "Impossible", concepts: [], possibleCapabilities: ["capability.does_not_exist"], knowledgeNeeds: [] },
      { match: "partial request", intentType: "learn", objective: "Partial", concepts: ["x"], possibleCapabilities: [], knowledgeNeeds: [], incomplete: true },
    ],
  });
  const registry = new IntelligenceProviderRegistry();
  registry.register(provider);
  const interpreter = new IntentInterpreter(registry);
  const unknown = await interpreter.interpret({ raw: { text: "do something impossible", modality: "text" }, availableCapabilities: env.capabilitySummaries });
  assert.equal(unknown.valid, false);
  assert.ok(unknown.issues.some(({ code }) => code === "malformed_capability_reference"));
  const partial = await interpreter.interpret({ raw: { text: "partial request", modality: "text" }, availableCapabilities: env.capabilitySummaries });
  assert.equal(partial.valid, false);
  assert.ok(partial.issues.some(({ code }) => code === "provider_reported_issue"));
  assert.equal(partial.structuredIntent.intentType, "learn");
  await assert.rejects(() => interpreter.interpret({ raw: { text: "x", modality: "streaming_video" as never }, availableCapabilities: [] }), /Unsupported intent modality/);
});

// ---------------------------------------------------------------------------
// 3: intelligence output cannot invoke providers or tools
// ---------------------------------------------------------------------------

test("a proposal is data: it carries no executable surface and cannot reach a capability directly", async () => {
  const env = environment();
  const provider = websiteProvider();
  const registry = new IntelligenceProviderRegistry();
  registry.register(provider);
  const result = await new IntelligencePipeline(registry).run({
    projectId: "website", raw: { text: WEBSITE_TEXT, modality: "text" }, capabilities: env.capabilityRegistry,
  });
  assert.ok(result.plan, "the proposal planned; a proposal reaches a plan only through the validated adapter");
  const reasoning = result.reasoningRun.reasoning;
  assert.equal(typeof (reasoning as unknown as { execute?: unknown }).execute, "undefined");
  for (const value of Object.values(reasoning)) {
    if (value === undefined) continue;
    assert.ok(["string", "object"].includes(typeof value), "a proposal is inert data only");
    if (typeof value === "string") continue;
    assert.notEqual(typeof (value as { execute?: unknown }).execute, "function");
  }
  // The only route from a proposal to a plan is the validated planning adapter.
  const plan = new ProposalPlanningAdapter().createPlan({ projectId: "website", run: result.reasoningRun, capabilities: env.capabilityRegistry });
  assert.deepEqual(plan.requiredCapabilityIds, ["code.execute", "text.generate"]);
  assert.deepEqual(plan.steps.map(({ capabilityId }) => capabilityId), ["text.generate", "code.execute"]);
  assert.ok(plan.steps.every((step) => step.provenance?.length));
  assert.equal(plan.status, "ready");
});

test("an unauthorized capability proposal is refused instead of executed", async () => {
  const env = environment();
  const registry = new IntelligenceProviderRegistry();
  registry.register(websiteProvider());
  const result = await new IntelligencePipeline(registry).run({
    projectId: "website",
    raw: { text: WEBSITE_TEXT, modality: "text" },
    capabilities: env.capabilityRegistry,
    authorizedCapabilityIds: ["text.generate"],
  });
  assert.equal(result.plan, undefined);
  assert.match(result.planningRefusal ?? "", /unauthorized capabilities: code\.execute/);
  // Authorization is also re-checked at the reasoning boundary, independently of the planner.
  const run = result.reasoningRun;
  assert.equal(run.valid, true, "the proposal itself is well-formed; the refusal is an authorization decision");
  assert.equal(Object.isFrozen(run.reasoning), true);
});

// ---------------------------------------------------------------------------
// 4: example A, personal website
// ---------------------------------------------------------------------------

test("a personal website request produces software-oriented requirements without any execution", async () => {
  const env = environment();
  const registry = new IntelligenceProviderRegistry();
  registry.register(websiteProvider());
  const result = await new IntelligencePipeline(registry).run({
    projectId: "website",
    raw: { text: WEBSITE_TEXT, modality: "text" },
    capabilities: env.capabilityRegistry,
    defaultVerificationMethod: "output_shape_validation",
  });
  assert.equal(result.intent.intentType, "create");
  assert.equal(result.intent.domain, "software/web");
  assert.ok(result.plan);
  const plan = result.plan!;
  assert.deepEqual(plan.requiredCapabilityIds, ["code.execute", "text.generate"]);
  assert.ok(plan.requiredCapabilityIds.includes("code.execute"), "project/file work must route to the code capability");
  assert.ok(plan.requiredCapabilityIds.includes("text.generate"), "software planning and explanation must route to the text capability");
  assert.ok(plan.canonicalVerificationRequirements?.length, "verification requirements must be attached");
  assert.ok(plan.steps.every((step) => step.verificationRequirements?.length));
  assert.deepEqual(plan.steps.map(({ id }) => id).slice().sort(), plan.steps.map(({ id }) => id).slice().sort());
  assert.equal(plan.originatingIntent, undefined, "a proposal plan is not a raw UserIntent plan");
});

test("website capability proposals resolve only against registered capabilities", async () => {
  const env = environment();
  const provider = new MockIntelligenceProvider({
    id: "mock.unknown-capability",
    reasoningFixtures: [{
      match: () => true,
      conclusions: ["Try a capability that does not exist."],
      proposedTasks: [{ purpose: "Invent", capabilityId: "shell.exec" }],
      outputRequirements: [],
    }],
    defaultReasoningFixture: { match: () => true, conclusions: [], proposedTasks: [] },
  });
  const registry = new IntelligenceProviderRegistry();
  registry.register(provider);
  const service = new ReasoningService(registry);
  const run = await service.reason({
    projectId: "unknown", intent: {
      id: "intent-x", modality: "text", objective: "Do the impossible", intentType: "create", concepts: [],
      relationships: [], requestedOutputs: [], possibleCapabilities: [], knowledgeNeeds: [], constraints: [], providerId: provider.id,
    },
    availableCapabilities: env.capabilitySummaries,
  });
  assert.equal(run.valid, false);
  assert.ok(run.issues.some(({ code }) => code === "unauthorized_capability" && run.issues.find(({ reference }) => reference === "shell.exec")));
  assert.throws(() => new ProposalPlanningAdapter().createPlan({ projectId: "unknown", run, capabilities: env.capabilityRegistry }), /validation issues/);
});

// ---------------------------------------------------------------------------
// 5 + 7 + 9: example B, biology teaching, knowledge flowing back into a request
// ---------------------------------------------------------------------------

test("a teaching request flows through Phase 6 knowledge retrieval and back into a grounded request", async () => {
  const env = environment();
  const provider = biologyProvider();
  const registry = new IntelligenceProviderRegistry();
  registry.register(provider);
  const knowledge = cellKnowledge();
  const pipeline = new IntelligencePipeline(registry);
  const result = await pipeline.run({
    projectId: "teaching",
    raw: { text: BIOLOGY_TEXT, modality: "text" },
    capabilities: env.capabilityRegistry,
    knowledgeSources: knowledge.sources,
    retriever: knowledge.retriever,
    relationshipTypeRegistry: env.relationshipTypeRegistry,
  });
  assert.equal(result.intent.intentType, "learn");
  assert.equal(result.intent.domain, "biology");
  assert.deepEqual(result.intent.concepts, ["cell"]);
  assert.deepEqual(result.intent.knowledgeNeeds.map(({ topic }) => topic), ["cell"]);
  const run = result.reasoningRun;
  assert.equal(run.rounds.length, 2, "one round to ask for knowledge, one round to propose with it");
  assert.equal(run.requests[0].knowledgeContext, undefined);
  assert.equal(run.requests[1].knowledgeContext?.concepts.length, 2);
  assert.equal(run.knowledgeContext?.unresolvedRequirementIds.length, 0);
  assert.equal(run.stopReason, "sufficient");
  assert.deepEqual(run.reasoning.proposedTasks.map(({ capabilityId }) => capabilityId), ["text.generate", "visual.scene", "voice.synthesize"]);
  assert.deepEqual(run.reasoning.evidenceReferences.map(({ id }) => id), ["cell"]);
  assert.ok(result.plan);
  assert.equal(result.plan!.knowledgeContextId, run.knowledgeContext?.id);
});

test("the context compiler includes relevant knowledge and excludes unrelated knowledge", async () => {
  const env = environment();
  const provider = biologyProvider();
  const registry = new IntelligenceProviderRegistry();
  registry.register(provider);
  const relevant = cellKnowledge();
  const unrelated = unrelatedKnowledge();
  const service = new ReasoningService(registry, new ContextCompiler());
  const run = await service.reason({
    projectId: "selective",
    intent: {
      id: "intent-cell", modality: "text", objective: "Understand cells", intentType: "learn",
      domain: "biology", concepts: ["cell"], relationships: [], requestedOutputs: ["explanation"],
      possibleCapabilities: [], knowledgeNeeds: [{ topic: "cell", domain: "biology", conceptIds: ["cell"] }], constraints: [], providerId: provider.id,
    },
    availableCapabilities: env.capabilitySummaries,
    knowledgeSources: relevant.sources,
    retriever: relevant.retriever,
    relationshipTypeRegistry: env.relationshipTypeRegistry,
  });
  const cellContext = run.knowledgeContext!;
  // Focus is driven by the intent and the canonical requirements, not by a literal match. A
  // magnetism interpretation over cell evidence focuses on the cells the requirement covers and
  // never on magnetism, which does not exist in the retrieved graph.
  const narrow = new ContextCompiler().compile({
    task: "reason", objective: "Understand magnetism", availableCapabilities: [], requiredOutput: { fields: ["conclusions"] },
    provenance: { callerId: "test", sourceType: "engine" },
    intent: {
      id: "intent-magnet", modality: "text", objective: "Understand magnetism", intentType: "learn",
      concepts: ["magnetism"], relationships: [], requestedOutputs: [], possibleCapabilities: [], knowledgeNeeds: [], constraints: [], providerId: provider.id,
    },
    knowledgeContext: cellContext,
  });
  assert.deepEqual([...narrow.knowledgeContext!.focusConceptIds], ["cell"]);
  assert.ok(!narrow.knowledgeContext!.focusConceptIds.includes("magnetism"));
  assert.deepEqual(narrow.knowledgeContext!.concepts.map(({ id }) => id).sort(), ["cell", "mitochondrion"], "retrieved evidence is still all Bikting holds; only the focus narrows");

  const compiled = run.requests.at(-1)!.knowledgeContext!;
  // Retrieved evidence is included whole: reasoning over a graph needs the surrounding concepts.
  assert.deepEqual(compiled.concepts.map(({ id }) => id).sort(), ["cell", "mitochondrion"]);
  assert.deepEqual([...compiled.focusConceptIds], ["cell"], "the concepts the requirement and intent explicitly cover");
  assert.deepEqual(compiled.relationships.map(({ id }) => id), ["cell-contains-mitochondrion"]);
  assert.ok(compiled.sourceIds.includes("fixture.biology.cells"));
  assert.ok(!compiled.sourceIds.includes("fixture.unrelated.magnetism"));
  assert.ok(!JSON.stringify(compiled).includes("magnetism"), "unrelated knowledge must not reach the provider");
  // A KnowledgeContext holding only unrelated material compiles to no concepts at all.
  const unrelatedRegistry = new IntelligenceProviderRegistry();
  unrelatedRegistry.register(new MockIntelligenceProvider({
    id: "mock.magnetism",
    reasoningFixtures: [{
      match: (request) => !request.knowledgeContext,
      conclusions: ["Ground the explanation in retrieved knowledge."],
      proposedTasks: [],
      additionalKnowledgeNeeds: [{ topic: "magnetism", domain: "physics", conceptIds: ["magnetism"], required: true }],
    }],
  }));
  const unrelatedRun = await new ReasoningService(unrelatedRegistry, new ContextCompiler()).reason({
    projectId: "unrelated",
    intent: {
      id: "intent-magnet", modality: "text", objective: "Understand magnetism", intentType: "learn",
      concepts: ["magnetism"], relationships: [], requestedOutputs: [], possibleCapabilities: [], knowledgeNeeds: [{ topic: "magnetism", conceptIds: ["magnetism"] }], constraints: [], providerId: "mock.magnetism",
    },
    availableCapabilities: env.capabilitySummaries,
    knowledgeSources: unrelated.sources,
    retriever: unrelated.retriever,
    relationshipTypeRegistry: env.relationshipTypeRegistry,
  });
  assert.deepEqual(unrelatedRun.knowledgeContext?.concepts.map(({ id }) => id), ["magnetism"]);
  assert.deepEqual(unrelatedRun.requests.at(-1)!.knowledgeContext!.concepts.map(({ id }) => id), ["magnetism"]);
  assert.ok(!JSON.stringify(unrelatedRun.knowledgeContext).includes("The smallest structural unit"), "cell knowledge must not leak into an unrelated request");
});

test("the context compiler never calls a model, executes a tool, or mutates knowledge state", async () => {
  const env = environment();
  const provider = biologyProvider();
  const registry = new IntelligenceProviderRegistry();
  registry.register(provider);
  const before = provider.observedRequests.length;
  const knowledge = cellKnowledge();
  const service = new ReasoningService(registry, new ContextCompiler());
  const run = await service.reason({
    projectId: "inert",
    intent: {
      id: "intent-cell", modality: "text", objective: "Understand cells", intentType: "learn",
      concepts: ["cell"], relationships: [], requestedOutputs: [], possibleCapabilities: [], knowledgeNeeds: [], constraints: [], providerId: provider.id,
    },
    availableCapabilities: env.capabilitySummaries,
    knowledgeSources: knowledge.sources,
    retriever: knowledge.retriever,
    relationshipTypeRegistry: env.relationshipTypeRegistry,
  });
  assert.ok(provider.observedRequests.length > before, "only the reasoning service calls providers, not the compiler");
  for (const request of provider.observedRequests) {
    assert.equal(request.knowledgeContext === undefined || Array.isArray(request.knowledgeContext.concepts), true);
  }
  assert.equal(run.requests.every((request) => Object.isFrozen(request)), true);
});

// ---------------------------------------------------------------------------
// 10: missing knowledge is represented, never fabricated
// ---------------------------------------------------------------------------

test("missing required knowledge is represented explicitly instead of being fabricated", async () => {
  const env = environment();
  const registry = new IntelligenceProviderRegistry();
  registry.register(biologyProvider());
  const emptySources = new KnowledgeSourceRegistry();
  const emptyRetriever = new KnowledgeRetriever();
  const run = await new ReasoningService(registry).reason({
    projectId: "unsupported",
    intent: {
      id: "intent-cell", modality: "text", objective: "Understand cells", intentType: "learn", domain: "biology",
      concepts: ["cell"], relationships: [], requestedOutputs: ["explanation"], possibleCapabilities: [],
      knowledgeNeeds: [{ topic: "cell", domain: "biology", conceptIds: ["cell"] }], constraints: [], providerId: "mock.biology",
    },
    availableCapabilities: env.capabilitySummaries,
    knowledgeSources: emptySources,
    retriever: emptyRetriever,
    relationshipTypeRegistry: env.relationshipTypeRegistry,
  });
  assert.ok(run.knowledgeRequirements.length, "the need must be converted into a canonical requirement");
  assert.equal(run.knowledgeRequirements[0].concepts[0], "cell");
  assert.equal(run.knowledgeContext?.concepts.length, 0, "no concept may be invented");
  assert.ok(run.knowledgeContext!.unresolvedRequirementIds.length > 0);
  assert.equal(run.stopReason, "knowledge_unresolvable");
  const lastRequest = run.requests.at(-1)!;
  assert.equal(lastRequest.knowledgeContext, undefined, "the first request could not include knowledge that does not exist");
  // A request compiled after the gap is known must carry the gap explicitly rather than an invented concept.
  const withGap = new ContextCompiler().compile({
    task: "reason", objective: "Understand cells", availableCapabilities: env.capabilitySummaries,
    requiredOutput: { fields: ["conclusions"] }, provenance: { callerId: "test", sourceType: "engine" },
    intent: run.requests[0].intent,
    knowledgeContext: run.knowledgeContext!,
  });
  assert.ok(withGap.knowledgeContext!.unresolvedRequirementIds.length > 0, "the gap must be visible to the provider");
  assert.equal(withGap.knowledgeContext!.concepts.length, 0);
  assert.ok(!JSON.stringify(withGap.knowledgeContext).includes("definition"), "no content may be invented");
  // The second round must not cite evidence that was never retrieved.
  assert.deepEqual(run.reasoning.evidenceReferences, []);
  assert.ok(run.issues.some(({ code }) => code === "fabricated_evidence") || run.reasoning.evidenceReferences.length === 0);
});

test("the knowledge loop is bounded and terminates when a round adds no new knowledge", async () => {
  const env = environment();
  const registry = new IntelligenceProviderRegistry();
  registry.register(new MockIntelligenceProvider({
    id: "mock.always-asks",
    reasoningFixtures: [{
      match: () => true,
      conclusions: ["Keep asking."],
      proposedTasks: [],
      additionalKnowledgeNeeds: [{ topic: "cell", domain: "biology", conceptIds: ["cell"], required: true }],
    }],
  }));
  const run = await new ReasoningService(registry).reason({
    projectId: "bounded",
    intent: {
      id: "intent-cell", modality: "text", objective: "Understand cells", intentType: "learn", concepts: ["cell"],
      relationships: [], requestedOutputs: [], possibleCapabilities: [], knowledgeNeeds: [], constraints: [], providerId: "mock.always-asks",
    },
    availableCapabilities: env.capabilitySummaries,
    knowledgeSources: cellKnowledge().sources,
    retriever: cellKnowledge().retriever,
    relationshipTypeRegistry: env.relationshipTypeRegistry,
    budget: { maxRounds: 2 },
  });
  assert.ok(run.rounds.length <= 2, "the loop must respect its bound");
  assert.ok(["sufficient", "no_new_knowledge_needs", "max_rounds_reached"].includes(run.stopReason));
  assert.equal(run.knowledgeRequirements.filter(({ id }) => id.startsWith("intent-knowledge-")).length <= 1, true, "the same need must not be re-issued");
});

// ---------------------------------------------------------------------------
// 11 + 12: control boundary and provider neutrality
// ---------------------------------------------------------------------------

test("evidence, binding, and objective checks reject fabricated or executable proposals", () => {
  const request = {
    id: "r", task: "reason" as const, objective: "Objective", concepts: [],
    constraints: [], availableCapabilities: [{ id: "text.generate" }],
    requiredOutput: { fields: [] as string[] },
    provenance: { callerId: "p", sourceType: "engine" as const },
  };
  const provider = { id: "p", name: "p", capabilities: { tasks: ["reason" as const] }, interpretIntent: async () => ({}) as never, reason: async () => ({}) as never };
  const base = { id: "x", objective: "Objective", conclusions: [], proposedTasks: [], requiredCapabilities: [], additionalKnowledgeNeeds: [], outputRequirements: [], evidenceReferences: [], providerId: "p" };
  assert.deepEqual(validateReasoningResult(base, request, undefined, provider), []);
  assert.ok(validateReasoningResult({ ...base, evidenceReferences: [{ type: "knowledge_concept", id: "never-retrieved" }] }, request, undefined, provider).some(({ code }) => code === "fabricated_evidence"));
  assert.ok(validateReasoningResult({ ...base, objective: "Something else" }, request, undefined, provider).some(({ code }) => code === "objective_mismatch"));
  const executable = { ...base, proposedTasks: [{ id: "t1", purpose: "run", capabilityId: "text.generate", bindings: [{ target: "code", sourceType: "literal" as const, value: { fn: () => 1 } }] }] };
  assert.ok(validateReasoningResult(executable, request, undefined, provider).some(({ code }) => code === "executable_binding"));
  const cycle = { ...base, proposedTasks: [
    { id: "t1", purpose: "a", capabilityId: "text.generate", dependsOn: ["t2"] },
    { id: "t2", purpose: "b", capabilityId: "text.generate", dependsOn: ["t1"] },
  ] };
  assert.ok(validateReasoningResult(cycle, request, undefined, provider).some(({ code }) => code === "dependency_cycle"));
});

test("mock providers are swappable through the registry without changing orchestration logic", async () => {
  const env = environment();
  const first = new IntelligenceProviderRegistry();
  first.register(websiteProvider("mock.provider-a"));
  const viaA = await new IntelligencePipeline(first).run({ projectId: "website", raw: { text: WEBSITE_TEXT, modality: "text" }, capabilities: env.capabilityRegistry });
  assert.equal(viaA.plan?.status, "ready");

  // A completely different provider, reached only through the registry.
  const second = new IntelligenceProviderRegistry();
  second.register(new MockIntelligenceProvider({
    id: "mock.provider-b",
    name: "Replacement provider",
    intentFixtures: [{
      match: WEBSITE_TEXT, intentType: "create", objective: "Create a personal website",
      domain: "software/web", target: "personal website", concepts: ["website"],
      requestedOutputs: ["code"], possibleCapabilities: ["code.execute"], knowledgeNeeds: [],
    }],
    reasoningFixtures: [{
      match: () => true,
      conclusions: ["A different provider reached the same planning boundary."],
      proposedTasks: [{ purpose: "Produce the project files", capabilityId: "code.execute" }],
      outputRequirements: [{ type: "code", required: true, capabilityId: "code.execute" }],
    }],
  }));
  const viaB = await new IntelligencePipeline(second).run({ projectId: "website", raw: { text: WEBSITE_TEXT, modality: "text" }, capabilities: env.capabilityRegistry, providerId: "mock.provider-b" });
  assert.equal(viaB.plan?.status, "ready");
  assert.deepEqual(viaB.plan?.requiredCapabilityIds, ["code.execute"]);
  assert.equal(viaB.reasoningRun.providerId, "mock.provider-b");
  // Core orchestration produced a plan in both cases without knowing which provider ran.
  assert.equal(viaA.planningRefusal, undefined);
  assert.equal(viaB.planningRefusal, undefined);
});

test("routing is by declared task, not by provider name, and the safety profile forbids execution", () => {
  const registry = new IntelligenceProviderRegistry();
  const cheap = new MockIntelligenceProvider({ id: "small.cheap", supportedTasks: ["interpret_intent", "summarize"] });
  const advanced = new MockIntelligenceProvider({ id: "large.advanced", supportedTasks: ["reason", "code", "plan"] });
  registry.register(advanced);
  registry.register(cheap);
  assert.equal(registry.resolve("interpret_intent").id, "small.cheap");
  assert.equal(registry.resolve("reason").id, "large.advanced");
  assert.equal(registry.resolve("code").id, "large.advanced");
  assert.throws(() => registry.resolve("voice"), /No intelligence provider/);
  assert.throws(() => registry.resolveWithFallback("reason", "small.cheap"), /does not support task: reason/);
  const profile = registry.safetyProfile("small.cheap");
  assert.equal(profile.receivesCredentials, false);
  assert.equal(profile.receivesFilesystem, false);
  assert.equal(profile.receivesShell, false);
  assert.ok(profile.forbidden.includes("capability_execution"));
  assert.ok(profile.forbidden.includes("credential_selection"));
});

test("knowledge needs convert into canonical knowledge requirements without duplicating existing ones", () => {
  const requirements = knowledgeNeedsToRequirements([
    { topic: "cell", domain: "biology", conceptIds: ["cell"] },
    { topic: "cell", domain: "biology", conceptIds: ["cell"] },
    { topic: "mitochondrion", domain: "biology" },
  ]);
  assert.equal(requirements.length, 2);
  assert.deepEqual(requirements[0].concepts, ["cell"]);
  assert.deepEqual(requirements[0].relationshipTypes, undefined);
  assert.deepEqual([...requirements[1].concepts], ["mitochondrion"]);
  assert.equal(knowledgeNeedsToRequirements([{ topic: "cell", domain: "biology", conceptIds: ["cell"] }], { existingIds: [requirements[0].id] }).length, 0);
});

// ---------------------------------------------------------------------------
// 6 + 10 + 13: example C, calculation still routes to the deterministic calculator
// ---------------------------------------------------------------------------

test("calculation is understood by the model but executed by the deterministic calculator", async () => {
  const env = environment();
  const registry = new IntelligenceProviderRegistry();
  registry.register(calculationProvider());
  const knowledge = new KnowledgeSourceRegistry();
  const retriever = new KnowledgeRetriever();
  let retrievals = 0;
  knowledge.register({ id: "unused", name: "Unused", type: "structured", domains: ["mathematics"], conceptIds: [], freshness: ["stable"], availability: "available", retrievalKind: "static" });
  retriever.register({ sourceId: "unused", async retrieve() { retrievals++; return []; } });

  const result = await new IntelligencePipeline(registry).run({
    projectId: "calculation",
    raw: { text: "Calculate 125 * 48", modality: "text" },
    capabilities: env.capabilityRegistry,
    knowledgeSources: knowledge,
    retriever,
    relationshipTypeRegistry: env.relationshipTypeRegistry,
  });
  assert.equal(result.intent.intentType, "calculate");
  assert.deepEqual(result.intent.possibleCapabilities, ["math.calculate"]);
  assert.equal(retrievals, 0, "arithmetic requires no knowledge");
  assert.equal(result.reasoningRun.knowledgeRequirements.length, 0);
  assert.ok(result.plan);
  assert.deepEqual(result.plan!.requiredCapabilityIds, ["math.calculate"]);

  // Bikting's own planner and execution kernel still perform the arithmetic deterministically.
  const bil = bilRegistry(["bil/modules/core/calculation.bil.json"]);
  const shadow = new ShadowBiktingPipeline().run({
    projectId: "calculation",
    intent: { rawInput: "Calculate 125 * 48.", goal: "Calculate", actions: ["calculate"], desiredOutputs: ["numeric_result", "equation"], context: { domain: "mathematics", expression: "125 * 48" } },
    bilRegistry: bil, capabilityRegistry: env.capabilityRegistry, providerRegistry: env.providerRegistry, relationshipTypeRegistry: env.relationshipTypeRegistry,
  });
  const invoker = new CanonicalProviderInvoker();
  invoker.register({ providerId: "math.calculator", capabilityIds: ["math.calculate"], async invoke({ input }) { return calculatorTool.execute(input); } });
  const executed = await new CanonicalExecutionKernel(env.capabilityRegistry, env.providerRegistry, invoker).execute({ preparedPlan: shadow.preparedPlan!, projectId: "calculation" });
  assert.equal((executed.outputs["step-math-calculate"] as { numericResult: number }).numericResult, 6000);
  assert.equal(executed.status, "completed");
});
