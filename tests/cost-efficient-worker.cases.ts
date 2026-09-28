import test from "node:test";
import assert from "node:assert/strict";
import { SearchRouter } from "../src/search/search.router";
import { IntelligenceProviderRegistry } from "../src/intelligence/intelligence-provider.registry";
import { WorkerModelRouter } from "../src/workers/worker-routing";
import { WorkerExecutor, WorkerValidator, decideEscalation } from "../src/workers/worker-execution";
import { ContextBuilder } from "../src/workers/context-builder";
import { CostTelemetry, InMemoryValidatedExecutionMemory, ValidatedExperienceSearchProvider } from "../src/workers/execution-memory";
import { refreshReady, transitionTask } from "../src/projects/task-graph";

const task = (overrides = {}) => ({ id: "auth", projectId: "site", objective: "Implement auth", requiredCapability: "code", requirements: { coding: "medium", structuredOutput: true }, inputs: {}, evidence: [], constraints: [], outputSchema: { type: "object", required: ["code"] }, acceptanceCriteria: ["code field exists"], tokenBudget: { maxInputTokens: 500, maxOutputTokens: 100, maxAttempts: 2, maxEstimatedCost: 0.01 }, retryPolicy: { allowTargetedRepair: true, allowEscalation: false }, ...overrides });
const model = (id, price, output, calls) => ({ id, name: id, capabilities: { tasks: ["code"], model: { provider: "mock", model: id, coding: "high", structuredOutput: true, contextWindow: 1000, maxOutputTokens: 200, inputCostPerMillion: price, outputCostPerMillion: price } }, interpretIntent: async () => ({}), reason: async () => ({}), executeWorker: async (prompt) => { calls.push({ id, prompt }); return { output, inputTokens: 80, outputTokens: 12 }; } });

test("validated experience resolves without invoking either model; absent web is explicit", async () => {
  const memory = new InMemoryValidatedExecutionMemory();
  await assert.rejects(memory.store({ id: "bad", projectId: "site", taskId: "auth", intent: "Implement auth", relationships: [], capabilityIds: [], evidenceIds: [], result: {}, validation: { valid: false, issues: [], method: "test" }, repairHistory: [], recordedAt: "now" }));
  await memory.store({ id: "good", projectId: "site", taskId: "auth", intent: "Implement auth", relationships: [], capabilityIds: ["code"], evidenceIds: [], result: { code: "ok" }, validation: { valid: true, issues: [], method: "test" }, repairHistory: [], recordedAt: "now" });
  const search = new SearchRouter(); search.register(new ValidatedExperienceSearchProvider("memory", memory));
  const calls = []; const providers = new IntelligenceProviderRegistry(); providers.register(model("cheap", 1, { code: "ok" }, calls)); providers.register(model("expensive", 20, { code: "ok" }, calls));
  const result = await new WorkerExecutor(new WorkerModelRouter(providers), search).run(task(), { remainingCost: 0.01 });
  assert.equal(result.status, "resolved"); assert.equal(calls.length, 0); assert.deepEqual(result.telemetry, []);
  assert.equal((await search.search({ query: "unknown", sources: ["web"] })).status, "unavailable");
});

test("retrieval can resolve ahead of a model and context excludes unrelated data", async () => {
  const search = new SearchRouter(); search.register({ id: "docs", source: "documentation", available: true, search: async () => [{ id: "answer", source: "documentation", content: { code: "docs" }, relevance: 1, confidence: 0.95, estimatedTokens: 10, provenance: { sourceId: "docs", validated: true }, resolvesRequest: true }] });
  const calls = []; const providers = new IntelligenceProviderRegistry(); providers.register(model("cheap", 1, {}, calls));
  const result = await new WorkerExecutor(new WorkerModelRouter(providers), search).run(task(), { remainingCost: 0.01 });
  assert.equal(result.status, "resolved"); assert.equal(calls.length, 0);
  const context = new ContextBuilder().build(task(), [{ id: "needed", content: "relevant", source: "project", estimatedTokens: 8, taskIds: ["auth"] }, { id: "unrelated", content: "secret", source: "project", estimatedTokens: 8, taskIds: ["other"] }]);
  assert.deepEqual(context.items.map(({ id }) => id), ["needed"]); assert.ok(context.estimatedTokens <= 500);
});

test("cheapest suitable worker wins; validation yields a small repair and telemetry", async () => {
  const calls = []; const providers = new IntelligenceProviderRegistry(); providers.register(model("expensive", 50, { code: "ok" }, calls)); providers.register(model("cheap", 1, {}, calls));
  const search = new SearchRouter();
  const executor = new WorkerExecutor(new WorkerModelRouter(providers), search);
  const result = await executor.run(task(), { remainingCost: 0.01, context: [{ id: "irrelevant", content: "noise", source: "project", estimatedTokens: 20, taskIds: ["other"] }] });
  assert.equal(calls[0].id, "cheap"); assert.ok(calls[0].prompt.maxInputTokens === 500); assert.ok(calls[0].prompt.context.estimatedTokens <= 500);
  assert.equal(result.status, "repair_required"); assert.equal(result.validation.valid, false); assert.equal(result.repairTask.inputs.errors[0].path, "code");
  assert.deepEqual(result.repairTask.evidence, []); assert.ok(result.repairTask.tokenBudget.maxInputTokens <= 600);
  const usage = new CostTelemetry(); result.telemetry.forEach((call) => usage.record(call)); usage.recordResolution("search");
  assert.equal(usage.summary().totalModelCalls, 1); assert.equal(usage.summary().totalInputTokens, 80); assert.equal(usage.summary().totalOutputTokens, 12); assert.equal(usage.summary().searchResolutions, 1);
  assert.equal(new WorkerValidator().validate(task(), { code: "ok" }).valid, true);
});

test("capability and cost gates block unsuitable workers without automatic escalation", async () => {
  const calls = []; const providers = new IntelligenceProviderRegistry(); providers.register(model("expensive", 10000, { code: "ok" }, calls));
  const result = await new WorkerExecutor(new WorkerModelRouter(providers), new SearchRouter()).run(task(), { remainingCost: 0.000001 });
  assert.equal(result.status, "blocked"); assert.equal(calls.length, 0);
  assert.equal(decideEscalation(task(), { attempts: 1, searchExhausted: true, repairAttempted: false, failureCode: "repeated_validation_failure" }).allowed, false);
  assert.equal(decideEscalation(task({ retryPolicy: { allowTargetedRepair: true, allowEscalation: true } }), { attempts: 2, searchExhausted: true, repairAttempted: true, failureCode: "repeated_validation_failure" }).allowed, true);
});

test("task graph unlocks only completed dependencies and records validated references", () => {
  let graph = refreshReady({ projectId: "site", nodes: [{ id: "inspect", objective: "Inspect", dependsOn: [], status: "PENDING" }, { id: "auth", objective: "Auth", dependsOn: ["inspect"], status: "PENDING" }] });
  assert.deepEqual(graph.nodes.map(({ status }) => status), ["READY", "PENDING"]);
  graph = transitionTask(graph, "inspect", "RUNNING"); graph = transitionTask(graph, "inspect", "VALIDATING");
  assert.throws(() => transitionTask(graph, "inspect", "COMPLETED"));
  graph = transitionTask(graph, "inspect", "COMPLETED", "validated:inspect");
  assert.equal(graph.nodes[1].status, "READY");
});

test("validated worker output becomes a reusable result and usage is counted automatically", async () => {
  const calls = []; const registry = new IntelligenceProviderRegistry(); registry.register(model("cheap", 1, { code: "verified" }, calls));
  const memory = new InMemoryValidatedExecutionMemory(), usage = new CostTelemetry(), search = new SearchRouter();
  search.register(new ValidatedExperienceSearchProvider("memory", memory));
  const executor = new WorkerExecutor(new WorkerModelRouter(registry), search, undefined, undefined, undefined, undefined, usage, memory);
  assert.equal((await executor.run(task(), { remainingCost: 0.01 })).status, "completed");
  assert.equal((await executor.run(task(), { remainingCost: 0.01 })).status, "resolved");
  assert.equal(calls.length, 1); assert.equal(usage.summary().totalModelCalls, 1); assert.equal(usage.summary().cacheHits, 1);
});
