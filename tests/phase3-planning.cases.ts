import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BilCompiler } from "../src/bil/bil.compiler";
import { parseBilModule } from "../src/bil/bil.parser";
import { BilPlanningAdapter, validateCanonicalPlan } from "../src/bil/bil.planning.adapter";
import { BilRegistry } from "../src/bil/bil.registry";
import { resolveBil } from "../src/bil/bil.resolver";
import { CapabilityRegistry } from "../src/capabilities/capability.registry";
import { AuthorizationGrant, AuthorizationRequirement } from "../src/core/access";
import { evaluatePlanAuthorization } from "../src/core/authorization";
import { createDefaultRelationshipTypeRegistry } from "../src/core/relationship.registry";
import { ExecutionPlan } from "../src/planning/plan.types";
import { prepareExecutionPlan } from "../src/planning/prepared-plan";
import { adaptLegacyProvider } from "../src/providers/legacyCapabilityAdapter";
import { CapabilityProviderRegistry } from "../src/providers/provider.registry";
import { resolvePlanProviders } from "../src/providers/provider.resolver";
import { createDefaultRegistries } from "../src/bikting/core/registry/createDefaultRegistries.js";
import { createSemanticObject } from "../src/bikting/core/types/semantic.js";
import { mockSemanticInterpreter } from "../src/bikting/core/adapters/mockSemanticInterpreter.js";
import { planIntent } from "../src/bikting/core/planner/planIntent.js";
import { ExecutionEvent, ExecutionEventType } from "../src/execution/events";

const modulePaths = [
  "bil/modules/core/calculation.bil.json", "bil/modules/core/code-generation.bil.json", "bil/modules/core/dataset-analysis.bil.json", "bil/modules/core/vision-interpretation.bil.json",
  "bil/modules/science/electric-motor.bil.json", "bil/modules/science/force.bil.json", "bil/modules/science/force-relationship.bil.json",
  "bil/modules/workflows/equation-plot.bil.json", "bil/modules/workflows/force-plot.bil.json",
];

function registries() {
  const bil = new BilRegistry(); modulePaths.forEach((path) => bil.register(parseBilModule(readFileSync(path, "utf8"))));
  const capabilities = new CapabilityRegistry(); const providers = new CapabilityProviderRegistry(); const ids = new Set<string>(); const active = createDefaultRegistries();
  for (const adapter of [...active.tools.list(), ...active.models.list()]) {
    const adapted = adaptLegacyProvider(adapter); providers.register(adapted.provider);
    for (const capability of adapted.capabilities) if (!ids.has(capability.id)) { capabilities.registerCapability(capability); ids.add(capability.id); }
  }
  return { bil, capabilities, providers, active };
}

async function shadow(text: string) {
  const all = registries(); const semantic = createSemanticObject(await mockSemanticInterpreter({ text }));
  const resolution = resolveBil(all.bil, { intents: [semantic.intent], concepts: semantic.concepts, relationships: semantic.relationships, requestedOutputs: semantic.requestedOutputs, modality: semantic.modality, context: semantic.context });
  const intent = { rawInput: text, goal: semantic.goals[0] ?? semantic.intent, actions: [semantic.intent], objects: semantic.concepts, desiredOutputs: semantic.requestedOutputs, context: semantic.context };
  const context = new BilCompiler().compile({ intent, resolution, modules: resolution.selectedModuleIds.map((id) => all.bil.get(id)!), capabilityRegistry: all.capabilities, relationshipTypeRegistry: createDefaultRelationshipTypeRegistry(), bilRegistry: all.bil });
  const plan = new BilPlanningAdapter().createPlan(context); return { ...all, semantic, resolution, context, plan };
}

test("BilContext becomes a stable immutable canonical plan with provenance and verification", async () => {
  const first = await shadow("Plot force as mass changes from 1 to 10 kg with acceleration 5 m/s2."); const second = await shadow("Plot force as mass changes from 1 to 10 kg with acceleration 5 m/s2.");
  assert.equal(first.plan.id, second.plan.id);
  assert.equal(Object.isFrozen(first.plan), true);
  assert.equal(first.plan.bilContextId, first.context.id);
  assert.ok(first.plan.steps.every((step) => step.provenance?.every(({ contextId }) => contextId === first.context.id)));
  assert.ok(first.plan.canonicalVerificationRequirements?.length);
  assert.throws(() => (first.plan.steps as unknown[]).push({}), TypeError);
});

test("workflow and capability requirements become steps with dependencies, inputs, and outputs", async () => {
  const force = await shadow("Plot force as mass changes from 1 to 10 kg with acceleration 5 m/s2.");
  assert.deepEqual(force.plan.steps.map(({ id }) => id), ["input-generation", "physics-calculation", "plot-generation", "visual-output"]);
  assert.deepEqual(force.plan.steps[2].dependsOn, ["input-generation", "physics-calculation"]);
  assert.ok(force.plan.steps.every(({ expectedInputs, expectedOutputs }) => expectedInputs && expectedOutputs));
  const calculation = await shadow("Calculate 25 * 48.");
  assert.deepEqual(calculation.plan.steps.map(({ id, capabilityId }) => [id, capabilityId]), [["step-math-calculate", "math.calculate"]]);
});

test("unknown capability is explicit and invalid dependency cycles fail planning validation", async () => {
  const result = await shadow("Calculate 25 * 48."); const broken = structuredClone(result.plan) as ExecutionPlan;
  broken.steps[0].dependsOn = [broken.steps[0].id];
  assert.throws(() => validateCanonicalPlan(broken), /dependency cycle/);
  const context = structuredClone(result.context) as typeof result.context;
  Object.defineProperty(context, "unresolvedReferences", { value: [{ type: "unknown_capability", moduleIds: ["test"], reference: "unknown.run", reason: "unknown" }] });
  Object.defineProperty(context, "capabilityRequirements", { value: [...context.capabilityRequirements, { declaration: { capabilityId: "unknown.run", required: true }, provenance: [{ moduleId: "test", moduleVersion: "1.0.0", category: "capability_requirement", declarationId: "unknown.run" }] }] });
  Object.defineProperty(context, "requiredCapabilityIds", { value: [...context.requiredCapabilityIds, "unknown.run"] });
  const plan = new BilPlanningAdapter().createPlan(context);
  assert.equal(plan.status, "draft"); assert.ok(plan.unresolvedCapabilityIds?.includes("unknown.run"));
});

test("provider resolution returns sorted candidates without invoking anything", async () => {
  const result = await shadow("Calculate 25 * 48."); let invoked = 0;
  const providers = new CapabilityProviderRegistry();
  providers.register({ id: "provider.z", name: "Z", capabilityIds: ["math.calculate"], executorKind: "custom", availability: "available", metadata: { execute: () => invoked++ } });
  providers.register({ id: "provider.a", name: "A", capabilityIds: ["math.calculate"], executorKind: "deterministic", availability: "available" });
  providers.register({ id: "provider.offline", name: "Offline", capabilityIds: ["math.calculate"], executorKind: "custom", availability: "unavailable" });
  const resolution = resolvePlanProviders(result.plan, result.capabilities, providers);
  assert.deepEqual(resolution.steps[0].candidateProviderIds, ["provider.a", "provider.offline", "provider.z"]);
  assert.deepEqual(resolution.steps[0].availableProviderIds, ["provider.a", "provider.z"]);
  assert.equal(invoked, 0);
  assert.equal(resolvePlanProviders(result.plan, result.capabilities, new CapabilityProviderRegistry()).steps[0].status, "no_provider");
  const offline = new CapabilityProviderRegistry(); offline.register({ id: "offline", name: "Offline", capabilityIds: ["math.calculate"], executorKind: "custom", availability: "unavailable" });
  assert.equal(resolvePlanProviders(result.plan, result.capabilities, offline).steps[0].status, "unavailable");
});

test("authorization distinguishes authorized, missing, denied, and blocked without granting permission", async () => {
  const result = await shadow("Calculate 25 * 48.");
  const requirement: AuthorizationRequirement = { id: "auth.math", providerId: "secured", authorizationType: "oauth", scopes: ["calculate"], userApprovalRequired: true };
  const providers = new CapabilityProviderRegistry(); providers.register({ id: "secured", name: "Secured", capabilityIds: ["math.calculate"], executorKind: "api", availability: "available", authorizationRequirements: [requirement] });
  const resolution = resolvePlanProviders(result.plan, result.capabilities, providers);
  const missing = evaluatePlanAuthorization(resolution, []);
  assert.equal(missing.steps[0].providers[0].status, "authorization_required"); assert.deepEqual(missing.blockedStepIds, [result.plan.steps[0].id]);
  const granted: AuthorizationGrant = { id: "grant", requirementId: requirement.id, providerId: "secured", status: "granted", grantedScopes: ["calculate"], grantedAt: "2026-01-01T00:00:00.000Z" };
  assert.equal(evaluatePlanAuthorization(resolution, [granted]).steps[0].status, "authorized");
  const revoked = { ...granted, id: "revoked", status: "revoked" as const };
  assert.equal(evaluatePlanAuthorization(resolution, [revoked]).steps[0].providers[0].status, "denied");
  assert.equal(missing.steps[0].providers[0].grantIds.length, 0);
});

test("prepared plans represent ready, partial, and blocked states with provenance", async () => {
  const result = await shadow("Calculate 25 * 48.");
  const resolved = resolvePlanProviders(result.plan, result.capabilities, result.providers); const authorized = evaluatePlanAuthorization(resolved, []);
  const ready = prepareExecutionPlan(result.plan, resolved, authorized);
  assert.equal(ready.status, "ready"); assert.deepEqual(ready.provenance, result.plan.provenance);
  const none = resolvePlanProviders(result.plan, result.capabilities, new CapabilityProviderRegistry());
  assert.equal(prepareExecutionPlan(result.plan, none, evaluatePlanAuthorization(none, [])).status, "unresolved");
  const plot = await shadow("Plot y = x2."); const mathOnly = new CapabilityProviderRegistry(); mathOnly.register({ id: "math", name: "Math", capabilityIds: ["math.calculate"], executorKind: "deterministic", availability: "available" });
  const partialResolution = resolvePlanProviders(plot.plan, plot.capabilities, mathOnly);
  assert.equal(prepareExecutionPlan(plot.plan, partialResolution, evaluatePlanAuthorization(partialResolution, [])).status, "partial");
  const requirement: AuthorizationRequirement = { id: "auth", providerId: "only", authorizationType: "oauth", userApprovalRequired: true };
  const secured = new CapabilityProviderRegistry(); secured.register({ id: "only", name: "Only", capabilityIds: ["math.calculate"], executorKind: "api", availability: "available", authorizationRequirements: [requirement] });
  const securedResolution = resolvePlanProviders(result.plan, result.capabilities, secured);
  assert.equal(prepareExecutionPlan(result.plan, securedResolution, evaluatePlanAuthorization(securedResolution, [])).status, "blocked");
});

test("Phase 3 observability event types are available as contracts without runtime wiring", () => {
  const types: ExecutionEventType[] = ["bil_resolution_started", "bil_resolution_completed", "bil_context_compiled", "planning_started", "planning_completed", "provider_resolution_started", "provider_resolution_completed", "authorization_evaluated"];
  const events: ExecutionEvent[] = types.map((type, index) => ({ id: `event-${index}`, type, projectId: "shadow", occurredAt: "2026-01-01T00:00:00.000Z" }));
  assert.deepEqual(events.map(({ type }) => type), types);
});

test("provider and prepared-plan output is deterministic across registration order", async () => {
  const result = await shadow("Calculate 25 * 48."); const left = new CapabilityProviderRegistry(); const right = new CapabilityProviderRegistry();
  const values = [{ id: "b", name: "B", capabilityIds: ["math.calculate"], executorKind: "custom" as const, availability: "available" as const }, { id: "a", name: "A", capabilityIds: ["math.calculate"], executorKind: "deterministic" as const, availability: "available" as const }];
  values.forEach((value) => left.register(value)); [...values].reverse().forEach((value) => right.register(value));
  assert.deepEqual(resolvePlanProviders(result.plan, result.capabilities, left), resolvePlanProviders(result.plan, result.capabilities, right));
});

const cases = [
  ["Calculate 25 * 48.", ["math.calculate"], []],
  ["Plot y = x2.", ["math.calculate", "visual.scene"], []],
  ["Explain how an electric motor works.", ["physics.represent", "math.calculate", "visual.scene", "text.generate", "voice.synthesize"], ["physics.represent"]],
  ["Show the relationship between force, mass and acceleration.", ["physics.represent", "math.calculate", "visual.scene", "text.generate"], ["physics.represent"]],
  ["Analyze this image.", ["vision.interpret"], []],
  ["Write a Python function that calculates compound interest.", ["code.execute", "text.generate"], ["code.execute"]],
  ["What caused this trend in my dataset?", ["statistics.analyze", "text.generate"], []],
] as const;

test("all seven authoritative planning intents have shadow capability, step, output, and availability parity", async () => {
  for (const [text, expected, expectedUnavailable] of cases) {
    const result = await shadow(text); const authoritative = planIntent(result.semantic, result.active);
    assert.deepEqual(result.plan.requiredCapabilityIds, [...expected], text);
    assert.deepEqual(result.plan.requiredCapabilityIds, authoritative.capabilities, text);
    assert.deepEqual(result.plan.steps.map(({ capabilityId }) => capabilityId), authoritative.steps.filter(({ capability }: { capability?: string }) => capability).map(({ capability }: { capability: string }) => capability), text);
    const authoritativeOutputs = new Set(authoritative.steps.flatMap(({ expectedOutputs = [] }: { expectedOutputs?: string[] }) => expectedOutputs));
    for (const step of result.plan.steps) for (const output of step.expectedOutputs ?? []) assert.ok(authoritativeOutputs.has(output.type), `${text}: ${output.type}`);
    const providers = resolvePlanProviders(result.plan, result.capabilities, result.providers);
    assert.deepEqual(providers.steps.filter(({ unresolvedProvider }) => unresolvedProvider).map(({ capabilityId }) => capabilityId), [...expectedUnavailable], `${text}: shadow unavailable providers`);
    for (const requirement of authoritative.requiredCapabilities) {
      const shadowSteps = providers.steps.filter(({ capabilityId }) => capabilityId === requirement.requiredCapability);
      assert.ok(shadowSteps.length, `${text}: missing provider resolution for ${requirement.requiredCapability}`);
      if (requirement.status === "unavailable") assert.ok(shadowSteps.every(({ unresolvedProvider }) => unresolvedProvider));
    }
    assert.ok(result.plan.steps.every(({ verificationRequirements }) => verificationRequirements));
  }
});
