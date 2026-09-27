import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BilCompiler } from "../src/bil/bil.compiler";
import { BilCompilationError } from "../src/bil/bil.errors";
import { parseBilModule } from "../src/bil/bil.parser";
import { BilRegistry } from "../src/bil/bil.registry";
import { resolveBil } from "../src/bil/bil.resolver";
import { BilModule } from "../src/bil/bil.types";
import { CapabilityRegistry } from "../src/capabilities/capability.registry";
import { createDefaultRelationshipTypeRegistry, RelationshipTypeRegistry } from "../src/core/relationship.registry";
import { adaptLegacyProvider } from "../src/providers/legacyCapabilityAdapter";
import { createDefaultRegistries } from "../src/bikting/core/registry/createDefaultRegistries.js";
import { createSemanticObject } from "../src/bikting/core/types/semantic.js";
import { mockSemanticInterpreter } from "../src/bikting/core/adapters/mockSemanticInterpreter.js";
import { planIntent } from "../src/bikting/core/planner/planIntent.js";

const paths = ["bil/modules/core/calculation.bil.json", "bil/modules/science/force.bil.json", "bil/modules/workflows/force-plot.bil.json"];
const load = (path: string): BilModule => parseBilModule(readFileSync(path, "utf8"));
const clone = <T>(value: T): T => structuredClone(value);

function bilRegistry(): BilRegistry { const registry = new BilRegistry(); paths.map(load).forEach((module) => registry.register(module)); return registry; }
function capabilityRegistry(): CapabilityRegistry {
  const registry = new CapabilityRegistry(); const seen = new Set<string>(); const legacy = createDefaultRegistries();
  for (const adapter of [...legacy.tools.list(), ...legacy.models.list()]) for (const capability of adaptLegacyProvider(adapter).capabilities) if (!seen.has(capability.id)) { registry.registerCapability(capability); seen.add(capability.id); }
  return registry;
}
function compilerInput(moduleIds: string[], registry = bilRegistry()) {
  const modules = moduleIds.map((id) => registry.get(id)!);
  return { intent: { rawInput: "structured", goal: "Structured goal" }, resolution: resolveBil(registry, { intents: [], concepts: [] }), modules, capabilityRegistry: capabilityRegistry(), relationshipTypeRegistry: createDefaultRelationshipTypeRegistry(), bilRegistry: registry };
}
function compileForcePlot() { return new BilCompiler().compile(compilerInput(["bil.workflow.force_plot"])); }

test("compiler creates immutable canonical context with stable identity and no provider selection", () => {
  const first = compileForcePlot(); const second = compileForcePlot();
  assert.equal(first.id, second.id);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.intent), true);
  assert.equal(first.graph.isSealed(), true);
  assert.throws(() => first.graph.addEntity({ id: "new", kind: "concept", name: "New" }), /sealed/);
  assert.throws(() => (first.requiredCapabilityIds as string[]).push("other"), TypeError);
  assert.equal(Object.hasOwn(first, "provider"), false);
  assert.equal(Object.hasOwn(first, "executionResults"), false);
});

test("compiler resolves canonical capabilities and preserves unknown capabilities as unresolved", () => {
  const context = compileForcePlot();
  assert.deepEqual(context.capabilities.map(({ id }) => id), context.requiredCapabilityIds);
  const registry = bilRegistry(); const module = clone(registry.get("bil.core.calculation")!); module.capabilityRequirements[0].capabilityId = "unknown.calculate";
  const input = compilerInput([], registry); input.modules = [module];
  const unknown = new BilCompiler().compile(input);
  assert.equal(unknown.capabilities.length, 0);
  assert.ok(unknown.unresolvedReferences.some(({ type, reference }) => type === "unknown_capability" && reference === "unknown.calculate"));
});

test("canonical relationship registry is deterministic, extensible, and rejects duplicates and unknowns", () => {
  const registry = createDefaultRelationshipTypeRegistry();
  assert.equal(registry.assert("depends_on").id, "depends_on");
  assert.deepEqual(registry.list().map(({ id }) => id), [...registry.list().map(({ id }) => id)].sort());
  assert.throws(() => registry.register("depends_on"), /already registered/);
  assert.throws(() => registry.assert("invented_by_module"), /Unknown relationship type/);
});

test("compiler rejects unknown relationship types explicitly", () => {
  const registry = bilRegistry(); const module = clone(registry.get("bil.science.force")!); module.relationships[0].type = "invented_by_module";
  const input = compilerInput([], registry); input.modules = [module];
  assert.throws(() => new BilCompiler().compile(input), (error: unknown) => error instanceof BilCompilationError && error.issues.some(({ type }) => type === "unknown_relationship_type"));
});

test("concepts, relationships, knowledge modules, graph, and provenance compile canonically", () => {
  const registry = bilRegistry(); const context = new BilCompiler().compile(compilerInput(["bil.science.force"], registry));
  assert.deepEqual(context.concepts.map(({ id }) => id), ["force", "mass", "acceleration"]);
  assert.equal(context.relationships.length, 2);
  assert.equal(context.knowledgeModules[0].id, "knowledge.bil.science.force");
  assert.equal(context.graph.getEntity("force")?.kind, "concept");
  assert.equal(context.graph.getOutgoing("force").length, 2);
  assert.deepEqual((context.relationships[0].metadata?.bilProvenance as unknown[])[0], { moduleId: "bil.science.force", moduleVersion: "1.0.0", category: "relationship", declarationId: "relationship.force_depends_on_mass" });
  assert.ok(context.capabilityRequirements[0].provenance[0].declarationId === "physics.calculate_force");
});

test("cross-module references resolve dependencies before dependents with version provenance", () => {
  const registry = bilRegistry(); const calculation = registry.get("bil.core.calculation")!;
  const dependent = clone(registry.get("bil.workflow.force_plot")!); dependent.id = "bil.workflow.dependent"; dependent.moduleReferences = [{ moduleId: calculation.id, version: "^1.0.0" }];
  registry.register(dependent);
  const context = new BilCompiler().compile(compilerInput([dependent.id], registry));
  assert.deepEqual(context.sourceModules.map(({ id }) => id), [calculation.id, dependent.id]);
  assert.ok(context.provenance.some(({ moduleId }) => moduleId === calculation.id));
  assert.equal(context.capabilityRequirements.find(({ declaration }) => declaration.capabilityId === "math.calculate")?.provenance.length, 2);
});

test("missing references, incompatible versions, and circular dependencies fail structurally", () => {
  const base = load("bil/modules/core/calculation.bil.json");
  const missing = clone(base); missing.id = "bil.test.missing"; missing.moduleReferences = [{ moduleId: "bil.missing", version: "1.0.0" }];
  assertCompilationIssue(missing, "missing_module");
  const incompatible = clone(base); incompatible.id = "bil.test.incompatible"; incompatible.moduleReferences = [{ moduleId: base.id, version: "^2.0.0" }];
  const versionRegistry = new BilRegistry(); versionRegistry.register(base); versionRegistry.register(incompatible);
  assert.throws(() => new BilCompiler().compile(compilerInput([incompatible.id], versionRegistry)), (error: unknown) => error instanceof BilCompilationError && error.issues.some(({ type }) => type === "incompatible_version"));
  const left = clone(base); left.id = "bil.test.left"; const right = clone(base); right.id = "bil.test.right";
  left.moduleReferences = [{ moduleId: right.id, version: "1.0.0" }]; right.moduleReferences = [{ moduleId: left.id, version: "1.0.0" }];
  const circular = new BilRegistry(); circular.register(left); circular.register(right);
  assert.throws(() => new BilCompiler().compile(compilerInput([left.id], circular)), (error: unknown) => error instanceof BilCompilationError && error.issues.some(({ type }) => type === "circular_module_dependency"));
});

test("conflicting constraints, concepts, and relationships return deterministic conflict records", () => {
  assertConflict("constraints", (left, right) => { left.constraints = [{ type: "limit", value: 1 }]; right.constraints = [{ type: "limit", value: 2 }]; }, "constraint");
  assertConflict("concepts", (left, right) => { left.concepts = [{ id: "shared", name: "Left" }]; right.concepts = [{ id: "shared", name: "Right" }]; }, "concept");
  assertConflict("relationships", (left, right) => { left.concepts = right.concepts = [{ id: "a" }, { id: "b" }]; left.relationships = [{ id: "rel.shared", type: "depends_on", from: "a", to: "b" }]; right.relationships = [{ id: "rel.shared", type: "produces", from: "a", to: "b" }]; }, "relationship");
});

test("contradictory capability, workflow, and output declarations do not silently choose a winner", () => {
  assertConflict("capability", (left, right) => { left.capabilityRequirements = [{ capabilityId: "math.calculate", required: true }]; right.capabilityRequirements = [{ capabilityId: "math.calculate", required: false }]; }, "capability_requirement");
  assertConflict("workflow", (left, right) => { left.workflow = { id: "workflow.shared", steps: [{ id: "one", capabilityId: "math.calculate" }] }; right.workflow = { id: "workflow.shared", steps: [{ id: "two", capabilityId: "math.calculate" }] }; }, "workflow");
  assertConflict("output", (left, right) => { left.outputRequirements = [{ id: "output.shared", type: "numeric_result", required: true }]; right.outputRequirements = [{ id: "output.shared", type: "graph", required: true }]; }, "output_requirement");
});

test("module ordering is deterministic regardless of registration and selection order", () => {
  const modules = paths.map(load); const first = new BilRegistry(); modules.forEach((module) => first.register(module)); const second = new BilRegistry(); [...modules].reverse().forEach((module) => second.register(module));
  const firstContext = new BilCompiler().compile(compilerInput(modules.map(({ id }) => id), first));
  const secondContext = new BilCompiler().compile(compilerInput([...modules].reverse().map(({ id }) => id), second));
  assert.deepEqual(firstContext.sourceModules, secondContext.sourceModules);
  assert.equal(firstContext.id, secondContext.id);
});

test("workflow compilation preserves steps, dependencies, requirements, outputs, and provenance", () => {
  const context = compileForcePlot(); const workflow = context.workflows[0];
  assert.deepEqual(workflow.steps.map(({ id }) => id), ["input-generation", "physics-calculation", "plot-generation", "visual-output"]);
  assert.deepEqual(workflow.steps[2].dependsOn, ["input-generation", "physics-calculation"]);
  assert.equal(workflow.steps[2].provenance[0].moduleId, "bil.workflow.force_plot");
  assert.equal(context.executionRequirements.length, 2);
  assert.equal(context.verificationRequirements.length, 2);
  assert.equal(context.outputRequirements.length, 3);
});

test("missing canonical workflow capability remains unresolved without provider lookup", () => {
  const input = compilerInput(["bil.workflow.force_plot"]); input.capabilityRegistry = new CapabilityRegistry();
  const context = new BilCompiler().compile(input);
  assert.ok(context.unresolvedReferences.some(({ type }) => type === "missing_workflow_capability"));
  assert.equal(context.capabilities.length, 0);
});

test("calculation and force-plot compiler shadows preserve authoritative planning semantics", async () => {
  for (const text of ["Calculate 25 * 48.", "Plot force as mass changes from 1 to 10 kg with acceleration 5 m/s2."]) {
    const semantic = createSemanticObject(await mockSemanticInterpreter({ text })); const active = createDefaultRegistries(); const plan = planIntent(semantic, active);
    const registry = bilRegistry(); const resolution = resolveBil(registry, { intents: [semantic.intent], concepts: semantic.concepts, relationships: semantic.relationships, requestedOutputs: semantic.requestedOutputs, modality: semantic.modality, context: semantic.context });
    const context = new BilCompiler().compile({ intent: { rawInput: text, goal: semantic.goals[0] ?? semantic.intent, actions: [semantic.intent], objects: semantic.concepts, desiredOutputs: semantic.requestedOutputs, context: semantic.context }, resolution, modules: resolution.selectedModuleIds.map((id) => registry.get(id)!), capabilityRegistry: capabilityRegistry(), relationshipTypeRegistry: createDefaultRelationshipTypeRegistry(), bilRegistry: registry });
    assert.deepEqual(context.requiredCapabilityIds, plan.capabilities);
    const activeOutputs = new Set(plan.steps.flatMap(({ expectedOutputs = [] }: { expectedOutputs?: string[] }) => expectedOutputs));
    for (const output of context.outputRequirements.filter(({ declaration }) => declaration.required)) assert.ok(activeOutputs.has(output.declaration.type), `${output.declaration.type} missing from authoritative plan outputs`);
    assert.ok(context.verificationRequirements.length > 0);
    if (semantic.intent === "plot") {
      assert.deepEqual(context.workflows[0].steps.map(({ id, dependsOn = [] }) => ({ id, dependsOn })), plan.steps.filter(({ capability }: { capability?: string }) => capability).map(({ id, dependsOn = [] }: { id: string; dependsOn?: string[] }) => ({ id, dependsOn })));
      assert.deepEqual(context.relationships.map(({ from, type, to }) => ({ from, relation: type, to })), semantic.relationships.map(({ from, relation, to }: { from: string; relation: string; to: string }) => ({ from, relation, to })));
    }
  }
});

function assertCompilationIssue(module: BilModule, type: string): void {
  const registry = new BilRegistry(); registry.register(module);
  assert.throws(() => new BilCompiler().compile(compilerInput([module.id], registry)), (error: unknown) => error instanceof BilCompilationError && error.issues.some((item) => item.type === type));
}
function assertConflict(label: string, edit: (left: BilModule, right: BilModule) => void, type: string): void {
  const base = load("bil/modules/core/calculation.bil.json"); const left = clone(base); left.id = `bil.test.${label}.left`; const right = clone(base); right.id = `bil.test.${label}.right`; edit(left, right);
  const registry = new BilRegistry(); registry.register(left); registry.register(right);
  assert.throws(() => new BilCompiler().compile(compilerInput([left.id, right.id], registry)), (error: unknown) => error instanceof BilCompilationError && error.conflicts.some((conflict) => conflict.type === type && conflict.modules.length === 2));
}
