import test from "node:test";
import assert from "node:assert/strict";
import { previewIntent } from "../src/runtime/preview-pipeline";

test("canonical browser preview plans a website without executing it", async () => {
  const result = await previewIntent("Build my personal website");
  assert.equal(result.interpretation.valid, true);
  assert.equal(result.planning.status, "ready");
  assert.deepEqual(result.planning.steps.map(({ capabilityId }) => capabilityId), ["website.plan"]);
  assert.equal(result.execution, "not_started");
});

test("teaching request shows the missing evidence before execution", async () => {
  const result = await previewIntent("Teach me about cells in biology");
  assert.equal(result.planning.status, "blocked_knowledge");
  assert.deepEqual(result.knowledge.unresolvedTopics, ["biological cells"]);
});

test("unknown input is refused explicitly", async () => {
  const result = await previewIntent("An unseen request");
  assert.equal(result.interpretation.valid, false);
  assert.equal(result.planning.status, "refused");
  assert.deepEqual(result.planning.steps, []);
});
