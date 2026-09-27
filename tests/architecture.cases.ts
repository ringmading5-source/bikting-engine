import test from "node:test";
import assert from "node:assert/strict";
import { CapabilityRegistry } from "../src/capabilities/capability.registry";
import { resolveCapabilities } from "../src/capabilities/capability.resolver";
import { Capability } from "../src/capabilities/capability.types";
import { AuthorizationGrant, AuthorizationRequirement } from "../src/core/access";
import { BiktingGraph } from "../src/core/graph";
import { ExecutionExecutor } from "../src/execution/executor";
import { ExecutionEvent } from "../src/execution/events";
import { StatusVerifier, VerificationResult } from "../src/execution/verifier";
import { KnowledgeRegistry } from "../src/knowledge/knowledge.module";
import { traverseKnowledge } from "../src/knowledge/knowledge.graph";
import { KnowledgeModule } from "../src/knowledge/knowledge.types";
import { Planner } from "../src/planning/planner";
import { ProjectState } from "../src/projects/project.types";
import { adaptLegacyProvider } from "../src/providers/legacyCapabilityAdapter";
import { CapabilityProviderRegistry } from "../src/providers/provider.registry";
import { createDefaultRegistries } from "../src/bikting/core/registry/createDefaultRegistries.js";
import { createSemanticObject } from "../src/bikting/core/types/semantic.js";
import { mockSemanticInterpreter } from "../src/bikting/core/adapters/mockSemanticInterpreter.js";
import { planIntent } from "../src/bikting/core/planner/planIntent.js";

const calculation: Capability = {
  id: "capability.calculation",
  kind: "capability",
  name: "Calculation",
  inputs: [{ name: "expression", type: "string", required: true }],
  outputs: [{ name: "result", type: "numeric_result" }],
  operations: ["calculate"],
  verificationMethod: "result satisfies expression",
};

test("capability registry and resolution operate on provider-neutral capabilities", () => {
  const registry = new CapabilityRegistry();
  registry.registerCapability(calculation);
  assert.equal(registry.findByOutput("numeric_result")[0], calculation);
  assert.deepEqual(resolveCapabilities(registry, "calculate"), {
    requiredOperation: "calculate",
    capabilities: [calculation],
    unavailable: false,
  });
  assert.equal(resolveCapabilities(registry, "publish").unavailable, true);
});

test("providers remain separate and resolve concrete implementations by capability", () => {
  const providers = new CapabilityProviderRegistry();
  providers.register({
    id: "local.calculator",
    name: "Local calculator",
    capabilityIds: [calculation.id],
    executorKind: "deterministic",
    availability: "available",
  });
  assert.equal(providers.findAvailableByCapability(calculation.id)[0].id, "local.calculator");
  assert.equal(Object.hasOwn(calculation, "executorKind"), false);
  assert.equal(Object.hasOwn(providers.get("local.calculator")!, "operations"), false);
});

test("knowledge registry loads a module into the graph and supports typed traversal", () => {
  const graph = new BiktingGraph();
  const registry = new KnowledgeRegistry();
  const module: KnowledgeModule = {
    id: "knowledge.test",
    name: "Test knowledge",
    concepts: [
      { id: "concept.current", kind: "concept", name: "Current", content: {} },
      { id: "concept.field", kind: "concept", name: "Field", content: {} },
    ],
    relationships: [{ id: "rel.produces", type: "produces", from: "concept.current", to: "concept.field" }],
  };
  registry.registerModule(module, graph);
  assert.equal(traverseKnowledge(graph, "concept.current", "produces")[0].id, "concept.field");
});

test("planner creates capability-backed steps and executor preserves dependency blocking", async () => {
  const capabilities = new CapabilityRegistry();
  capabilities.registerCapability(calculation);
  const planner = new Planner(capabilities);
  const plan = planner.createPlan({ rawInput: "calculate", goal: "Calculate", actions: ["calculate"] });
  assert.equal(plan.status, "ready");
  assert.equal(plan.steps[0].capabilityId, calculation.id);

  plan.steps.push({ id: "dependent", action: "present", dependsOn: [plan.steps[0].id], status: "pending" });
  const context = await new ExecutionExecutor().execute(plan);
  assert.equal(context.results.get(plan.steps[0].id)?.status, "failed");
  assert.equal(context.results.get("dependent")?.status, "blocked");
});

test("verifier exposes canonical statuses, method, evidence, reason, and references", async () => {
  const result = await new StatusVerifier().verify({
    stepId: "step-1",
    status: "blocked",
    error: { message: "dependency failed" },
    provenance: { sourceType: "engine", sourceId: "engine", observedAt: new Date().toISOString() },
  });
  assert.equal(result.status, "RETRYABLE");
  assert.equal(result.method, "execution_status");
  assert.equal(result.reason, "dependency failed");
  assert.equal(result.taskId, "step-1");
});

test("authorization, execution event, verification, and project state contracts remain distinct", () => {
  const requirement: AuthorizationRequirement = {
    id: "auth-required",
    providerId: "provider.demo",
    authorizationType: "oauth",
    scopes: ["repo:read"],
    userApprovalRequired: true,
  };
  const grant: AuthorizationGrant = {
    id: "grant-1",
    requirementId: requirement.id,
    providerId: requirement.providerId,
    status: "granted",
    credentialReference: "credential-ref-1",
    grantedAt: "2026-01-01T00:00:00.000Z",
  };
  const event: ExecutionEvent = {
    id: "event-1",
    type: "authorization_granted",
    projectId: "project-1",
    providerId: requirement.providerId,
    occurredAt: grant.grantedAt,
  };
  const verification: VerificationResult = {
    id: "verification-1",
    status: "REQUIRES_USER",
    method: "visual_review",
    reason: "User confirmation is required.",
    verifiedAt: event.occurredAt,
  };
  const project: ProjectState = {
    id: "project-1",
    originalIntent: { rawInput: "Create a project", goal: "Create a project" },
    currentObjective: "Create a project",
    status: "blocked",
    tasks: [],
    providerSelections: {},
    authorizationRequirements: [requirement],
    authorizationGrants: [grant],
    artifacts: [],
    executionAttempts: [],
    observations: [],
    verificationResults: [verification],
    events: [event],
    errors: [],
    retries: [],
    decisions: [],
    createdAt: event.occurredAt,
    updatedAt: event.occurredAt,
  };
  assert.equal(project.authorizationGrants[0].credentialReference, "credential-ref-1");
  assert.equal(Object.hasOwn(project.authorizationGrants[0], "token"), false);
  assert.equal(project.events[0].type, "authorization_granted");
  assert.equal(project.verificationResults[0].status, "REQUIRES_USER");
});

test("compatibility adapter snapshots active definitions without changing their meaning", () => {
  const { tools } = createDefaultRegistries();
  const legacy = tools.get("math.calculator");
  const before = JSON.stringify(legacy.capabilityDefinitions);
  const adapted = adaptLegacyProvider(legacy);
  assert.equal(JSON.stringify(legacy.capabilityDefinitions), before);
  assert.equal(adapted.provider.id, legacy.id);
  assert.equal(adapted.provider.executorKind, "deterministic");
  assert.deepEqual(adapted.provider.capabilityIds, legacy.capabilityDefinitions.map(({ id }: { id: string }) => id));
  assert.deepEqual(adapted.capabilities[0].operations, ["calculate", "plot_series"]);
  assert.deepEqual(adapted.capabilities[0].outputs.map(({ type }) => type), ["numeric_result", "equation", "graph"]);
});

test("calculation and force-plot legacy plans have canonical capability/provider parity", async () => {
  const { tools, models, catalog } = createDefaultRegistries();
  const calculateSemantic = createSemanticObject(await mockSemanticInterpreter({ text: "Calculate 25 * 48." }));
  const calculationPlan = planIntent(calculateSemantic, { tools, models, catalog });
  const forceSemantic = createSemanticObject(await mockSemanticInterpreter({ text: "Plot force as mass changes from 1 to 10 kg with acceleration 5 m/s2." }));
  const forcePlan = planIntent(forceSemantic, { tools, models, catalog });
  const adapted = tools.list().map((tool: Parameters<typeof adaptLegacyProvider>[0]) => adaptLegacyProvider(tool));
  const representedIds = new Set(adapted.flatMap(({ provider }) => provider.capabilityIds));

  assert.deepEqual(calculationPlan.capabilities, ["math.calculate"]);
  assert.ok(calculationPlan.capabilities.every((id: string) => representedIds.has(id)));
  assert.deepEqual(forcePlan.capabilities, ["data.generate_range", "physics.calculate_force_series", "math.calculate", "visual.scene"]);
  assert.ok(forcePlan.capabilities.every((id: string) => representedIds.has(id)));
});
