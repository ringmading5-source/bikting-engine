import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseBilModule } from "../src/bil/bil.parser";
import { BilRegistry } from "../src/bil/bil.registry";
import { resolveBil } from "../src/bil/bil.resolver";

function registry(): BilRegistry {
  const result = new BilRegistry();
  for (const path of ["bil/modules/core/calculation.bil.json", "bil/modules/science/force.bil.json", "bil/modules/workflows/force-plot.bil.json"]) result.register(parseBilModule(readFileSync(path, "utf8")));
  return result;
}

test("resolver selects calculation from structured intent and explains every selection", () => {
  const result = resolveBil(registry(), { intents: ["calculate"], requestedOutputs: ["numeric_result", "equation"], context: { domain: "mathematics" } });
  assert.deepEqual(result.selectedModuleIds, ["bil.core.calculation"]);
  assert.deepEqual(result.requiredCapabilityIds, ["math.calculate"]);
  assert.ok(result.selections[0].reasons.includes("intent:calculate"));
  assert.ok(result.selections[0].reasons.includes("context:domain=mathematics"));
  assert.equal(result.unresolvedRequirements.length, 0);
});

test("resolver selects force plot only from structured concepts, outputs, intent, and context", () => {
  const result = resolveBil(registry(), {
    intents: ["plot"],
    concepts: ["force", "mass", "acceleration"],
    requestedOutputs: ["graph", "numeric_data", "structured_scene"],
    context: { domain: "physics", requestText: "words are deliberately ignored" },
  });
  assert.deepEqual(result.selectedModuleIds, ["bil.workflow.force_plot"]);
  assert.deepEqual(result.requiredCapabilityIds, ["data.generate_range", "physics.calculate_force_series", "math.calculate", "visual.scene"]);
  assert.equal(result.relevantRelationships.length, 3);
  assert.equal(result.executionRequirements.length, 2);
  assert.equal(result.verificationRequirements.length, 2);
  assert.equal(result.unresolvedRequirements.length, 0);
});

test("resolver never falls back and reports requested or unavailable requirements explicitly", () => {
  const unmatched = resolveBil(registry(), { intents: ["publish"], requestedCapabilityIds: ["content.publish"], requestedOutputs: ["publication"] });
  assert.deepEqual(unmatched.selectedModuleIds, []);
  assert.deepEqual(unmatched.unresolvedRequirements.map(({ kind, id }) => [kind, id]), [["capability", "content.publish"], ["output", "publication"]]);

  const unavailable = resolveBil(registry(), { intents: ["calculate"], requestedOutputs: ["numeric_result"], context: { domain: "mathematics" }, availableCapabilityIds: [] });
  assert.ok(unavailable.unresolvedRequirements.some(({ id, reason }) => id === "math.calculate" && reason.includes("availability")));
});
