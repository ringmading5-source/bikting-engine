import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseBilModule } from "../src/bil/bil.parser";
import { BilRegistry } from "../src/bil/bil.registry";
import { ShadowBiktingPipeline, ShadowPipelineInput } from "../src/bil/shadow-bikting-pipeline";
import { validateInputBindings } from "../src/bil/bil.planning.adapter";
import { CapabilityRegistry } from "../src/capabilities/capability.registry";
import { createDefaultRelationshipTypeRegistry } from "../src/core/relationship.registry";
import { InMemoryExecutionEventLog } from "../src/execution/event-log";
import { ExecutionPlan } from "../src/planning/plan.types";
import { projectShadowProjectState } from "../src/projects/shadow-project-state";
import { adaptLegacyProvider } from "../src/providers/legacyCapabilityAdapter";
import { CapabilityProviderRegistry } from "../src/providers/provider.registry";
import { SingleAuthorizedProviderPolicy, StableFirstAuthorizedProviderPolicy } from "../src/providers/provider-selection.policy";
import { createDefaultRegistries } from "../src/bikting/core/registry/createDefaultRegistries.js";
import { createSemanticObject } from "../src/bikting/core/types/semantic.js";
import { mockSemanticInterpreter } from "../src/bikting/core/adapters/mockSemanticInterpreter.js";
import { planIntent } from "../src/bikting/core/planner/planIntent.js";

const modulePaths = ["bil/modules/core/calculation.bil.json", "bil/modules/core/code-generation.bil.json", "bil/modules/core/dataset-analysis.bil.json", "bil/modules/core/vision-interpretation.bil.json", "bil/modules/science/electric-motor.bil.json", "bil/modules/science/force.bil.json", "bil/modules/science/force-relationship.bil.json", "bil/modules/workflows/equation-plot.bil.json", "bil/modules/workflows/force-plot.bil.json"];
function environment() {
  const bilRegistry = new BilRegistry(); modulePaths.forEach((path) => bilRegistry.register(parseBilModule(readFileSync(path, "utf8"))));
  const capabilityRegistry = new CapabilityRegistry(); const providerRegistry = new CapabilityProviderRegistry(); const ids = new Set<string>(); const active = createDefaultRegistries();
  for (const adapter of [...active.tools.list(), ...active.models.list()]) { const adapted = adaptLegacyProvider(adapter); providerRegistry.register(adapted.provider); for (const capability of adapted.capabilities) if (!ids.has(capability.id)) { capabilityRegistry.registerCapability(capability); ids.add(capability.id); } }
  return { bilRegistry, capabilityRegistry, providerRegistry, relationshipTypeRegistry: createDefaultRelationshipTypeRegistry(), active };
}
async function run(text: string, customize: Partial<ShadowPipelineInput> = {}) {
  const env = environment(); const semantic = createSemanticObject(await mockSemanticInterpreter({ text }));
  const input: ShadowPipelineInput = { projectId: `project-${semantic.intent}`, intent: { rawInput: text, goal: semantic.goals[0] ?? semantic.intent, actions: [semantic.intent], objects: semantic.concepts, desiredOutputs: semantic.requestedOutputs, context: semantic.context }, bilRegistry: env.bilRegistry, capabilityRegistry: env.capabilityRegistry, providerRegistry: env.providerRegistry, relationshipTypeRegistry: env.relationshipTypeRegistry, projectContext: { relationships: semantic.relationships, modality: semantic.modality, values: semantic.context }, ...customize };
  return { result: new ShadowBiktingPipeline().run(input), semantic, env, input };
}

test("shadow pipeline composes every planning stage, emits ordered compact events, and executes nothing", async () => {
  let invoked = 0; const base = await run("Calculate 25 * 48.");
  base.env.providerRegistry.register({ id: "zz.spy", name: "Spy", capabilityIds: ["math.calculate"], executorKind: "custom", availability: "available", metadata: { execute: () => invoked++ } });
  const result = new ShadowBiktingPipeline().run({ ...base.input, providerRegistry: base.env.providerRegistry });
  assert.equal(result.status, "ready"); assert.ok(result.context && result.plan && result.preparedPlan); assert.equal(invoked, 0);
  assert.deepEqual(result.events.map(({ type }) => type), ["intent_received", "bil_resolution_started", "bil_resolution_completed", "bil_context_compiled", "planning_started", "planning_completed", "provider_resolution_started", "provider_resolution_completed", "authorization_evaluated", "provider_selection_completed", "prepared_plan_created"]);
  assert.deepEqual(result.events.map(({ sequence }) => sequence), result.events.map((_, index) => index + 1));
  assert.ok(result.events.every(({ runId, correlationId }) => runId === result.runId && correlationId === result.runId));
  assert.ok(result.events.every(({ data }) => !data || !("plan" in data) && !("context" in data))); assert.equal(result.projectState.preparedPlanStatus, "ready");
  const again = new ShadowBiktingPipeline().run({ ...base.input, providerRegistry: base.env.providerRegistry });
  assert.equal(result.runId, again.runId); assert.deepEqual(result.events.map(({ id, type, data }) => ({ id, type, data })), again.events.map(({ id, type, data }) => ({ id, type, data })));
});

test("canonical bindings cover intent, context, literal, step output and field paths and reject invalid flow", async () => {
  const { result } = await run("Plot force as mass changes from 1 to 10 kg with acceleration 5 m/s2."); const plan = result.plan!;
  const sources = plan.steps.flatMap(({ inputBindings = [] }) => inputBindings.map(({ source }) => source.type));
  assert.ok(sources.includes("intent") && sources.includes("context") && sources.includes("literal") && sources.includes("step_output"));
  assert.ok(plan.steps.flatMap(({ inputBindings = [] }) => inputBindings).some(({ source }) => source.type === "step_output" && source.path.length));
  const invalidStep = structuredClone(plan) as ExecutionPlan; const physics = invalidStep.steps.find(({ id }) => id === "physics-calculation")!; physics.inputBindings![0] = { target: "masses", source: { type: "step_output", stepId: "missing", path: ["numeric_data"] } }; assert.throws(() => validateInputBindings(invalidStep), /unknown step/);
  const nonUpstream = structuredClone(plan) as ExecutionPlan; nonUpstream.steps[0].inputBindings = [{ target: "start", source: { type: "step_output", stepId: "visual-output", path: ["structured_scene"] } }]; assert.throws(() => validateInputBindings(nonUpstream), /non-upstream/);
  const duplicate = structuredClone(plan) as ExecutionPlan; duplicate.steps[0].inputBindings!.push(structuredClone(duplicate.steps[0].inputBindings![0])); assert.throws(() => validateInputBindings(duplicate), /Duplicate/);
  const badPath = structuredClone(plan) as ExecutionPlan; badPath.steps.find(({ id }) => id === "physics-calculation")!.inputBindings![0] = { target: "masses", source: { type: "step_output", stepId: "input-generation", path: ["secret"] } }; assert.throws(() => validateInputBindings(badPath), /unknown output/);
  const executable = structuredClone(plan) as ExecutionPlan; executable.steps[0].inputBindings = [{ target: "start", source: { type: "literal", value: () => 1 } }]; assert.throws(() => validateInputBindings(executable), /non-data literal/);
});

test("event projection is replayable and represents ready, blocked, and unresolved states", async () => {
  const ready = (await run("Calculate 25 * 48.")).result; assert.deepEqual(projectShadowProjectState(ready.events), projectShadowProjectState(ready.events));
  const secured = environment(); secured.providerRegistry = new CapabilityProviderRegistry(); secured.providerRegistry.register({ id: "secured", name: "Secured", capabilityIds: ["math.calculate"], executorKind: "api", availability: "available", authorizationRequirements: [{ id: "auth.math", providerId: "secured", authorizationType: "oauth", userApprovalRequired: true }] });
  const blocked = (await run("Calculate 25 * 48.", secured)).result; assert.equal(blocked.status, "blocked"); assert.equal(blocked.projectState.authorizationStatus, "blocked");
  const unresolved = (await run("Calculate 25 * 48.", { providerRegistry: new CapabilityProviderRegistry() })).result; assert.equal(unresolved.status, "partial"); assert.equal(unresolved.projectState.providerResolutionStatus, "unresolved");
  const log = new InMemoryExecutionEventLog("run"); log.append({ type: "intent_received", projectId: "p" }); log.append({ type: "bil_resolution_started", projectId: "p" }); assert.deepEqual(projectShadowProjectState(log.list()), projectShadowProjectState(log.list()));
});

test("provider policies handle one, multiple, and no authorized candidates deterministically without execution", async () => {
  const one = (await run("Calculate 25 * 48.", { providerPolicy: new SingleAuthorizedProviderPolicy() })).result; assert.equal(one.providerSelections![0].status, "selected");
  const base = await run("Calculate 25 * 48."); const multiple = new CapabilityProviderRegistry(); let invoked = 0;
  for (const id of ["z", "a"]) multiple.register({ id, name: id, capabilityIds: ["math.calculate"], executorKind: "custom", availability: "available", metadata: { execute: () => invoked++ } });
  const selected = new ShadowBiktingPipeline().run({ ...base.input, providerRegistry: multiple, providerPolicy: new StableFirstAuthorizedProviderPolicy() }); assert.equal(selected.providerSelections![0].providerId, "a"); assert.equal(invoked, 0);
  const strict = new ShadowBiktingPipeline().run({ ...base.input, providerRegistry: multiple, providerPolicy: new SingleAuthorizedProviderPolicy() }); assert.equal(strict.providerSelections![0].status, "unresolved");
  const none = (await run("Calculate 25 * 48.", { providerRegistry: new CapabilityProviderRegistry() })).result; assert.equal(none.providerSelections![0].status, "unresolved");
});

const cases = [
  ["Calculate 25 * 48.", ["math.calculate"]], ["Plot y = x2.", ["math.calculate", "visual.scene"]], ["Explain how an electric motor works.", ["physics.represent", "math.calculate", "visual.scene", "text.generate", "voice.synthesize"]], ["Show the relationship between force, mass and acceleration.", ["physics.represent", "math.calculate", "visual.scene", "text.generate"]], ["Analyze this image.", ["vision.interpret"]], ["Write a Python function that calculates compound interest.", ["code.execute", "text.generate"]], ["What caused this trend in my dataset?", ["statistics.analyze", "text.generate"]],
] as const;
test("all seven intent cases retain active capability, dependency, output, availability, and event parity", async () => {
  for (const [text, expected] of cases) { const { result, semantic, env } = await run(text); const active = planIntent(semantic, env.active); assert.deepEqual(result.plan!.requiredCapabilityIds, [...expected], text); assert.deepEqual(result.plan!.requiredCapabilityIds, active.capabilities, text); assert.equal(result.events.at(-1)?.type, "prepared_plan_created"); assert.equal(result.projectState.planId, result.plan!.id); assert.ok(result.diagnostics.length); assert.ok(result.plan!.steps.every(({ expectedOutputs, dependsOn, inputBindings }) => expectedOutputs && dependsOn && inputBindings)); }
});

test("expected compilation failures are structured rather than collapsed into generic exceptions", async () => {
  const env = environment(); const module = parseBilModule(readFileSync("bil/modules/core/calculation.bil.json", "utf8")); const conflict = structuredClone(module); conflict.id = "bil.core.calculation-conflict"; conflict.constraints = [{ type: "same", value: 1 }, { type: "same", value: 2 }]; conflict.appliesWhen = module.appliesWhen; env.bilRegistry.register(conflict);
  const base = await run("Calculate 25 * 48."); const result = new ShadowBiktingPipeline().run({ ...base.input, bilRegistry: env.bilRegistry }); assert.equal(result.status, "failed"); assert.equal(result.events.at(-1)?.type, "shadow_pipeline_failed"); assert.equal(result.projectState.phase, "failed"); assert.ok(result.diagnostics.some(({ kind }) => kind === "compilation"));
});
