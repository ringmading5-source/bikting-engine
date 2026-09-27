import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BilRegistry } from "../src/bil/bil.registry";
import { BilParseError, BilValidationError } from "../src/bil/bil.errors";
import { parseBilModule } from "../src/bil/bil.parser";

const fixture = (path: string) => readFileSync(path, "utf8");

test("parser loads all Phase 1 JSON fixtures into canonical inert modules", () => {
  const calculation = parseBilModule(fixture("bil/modules/core/calculation.bil.json"));
  const force = parseBilModule(fixture("bil/modules/science/force.bil.json"));
  const forcePlot = parseBilModule(fixture("bil/modules/workflows/force-plot.bil.json"));
  assert.equal(calculation.id, "bil.core.calculation");
  assert.equal(force.kind, "knowledge");
  assert.equal(forcePlot.workflow?.steps.length, 4);
  assert.equal(Object.hasOwn(forcePlot, "execute"), false);
});

test("parser reports malformed JSON separately from invalid BIL", () => {
  assert.throws(() => parseBilModule("{"), BilParseError);
  assert.throws(() => parseBilModule(JSON.stringify({ id: "incomplete" })), BilValidationError);
});

test("structural validation checks nested field types", () => {
  const source = JSON.parse(fixture("bil/modules/core/calculation.bil.json"));
  source.capabilityRequirements[0].required = "yes";
  source.outputRequirements[0].type = 42;
  assert.throws(() => parseBilModule(JSON.stringify(source)), (error: unknown) => {
    assert.ok(error instanceof BilValidationError);
    assert.match(error.message, /required must be a boolean/);
    assert.match(error.message, /type must be a non-empty string/);
    return true;
  });
});

test("semantic validation rejects executable conditions, duplicate declarations, and malformed workflows", () => {
  const source = JSON.parse(fixture("bil/modules/workflows/force-plot.bil.json"));
  source.appliesWhen.expression = "globalThis.process.exit()";
  source.capabilityRequirements.push(source.capabilityRequirements[0]);
  source.workflow.steps[0].dependsOn = ["missing-step"];
  assert.throws(() => parseBilModule(JSON.stringify(source)), (error: unknown) => {
    assert.ok(error instanceof BilValidationError);
    assert.match(error.message, /Unsupported condition/);
    assert.match(error.message, /Duplicate declaration/);
    assert.match(error.message, /Unknown workflow step/);
    return true;
  });
});

test("registry supports lookup and kind filtering and rejects duplicate module ids", () => {
  const registry = new BilRegistry();
  const calculation = registry.register(parseBilModule(fixture("bil/modules/core/calculation.bil.json")));
  registry.register(parseBilModule(fixture("bil/modules/workflows/force-plot.bil.json")));
  assert.equal(registry.get(calculation.id), calculation);
  assert.equal(registry.has(calculation.id), true);
  assert.deepEqual(registry.listByKind("workflow").map(({ id }) => id), ["bil.workflow.force_plot"]);
  assert.throws(() => registry.register(calculation), /Registry already contains/);
});
