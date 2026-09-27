import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseBilModule } from "../src/bil/bil.parser";
import { BilRegistry } from "../src/bil/bil.registry";
import { resolveBil } from "../src/bil/bil.resolver";
import { createDefaultRegistries } from "../src/bikting/core/registry/createDefaultRegistries.js";
import { mockSemanticInterpreter } from "../src/bikting/core/adapters/mockSemanticInterpreter.js";
import { createSemanticObject } from "../src/bikting/core/types/semantic.js";
import { planIntent } from "../src/bikting/core/planner/planIntent.js";

function bilRegistry(): BilRegistry {
  const registry = new BilRegistry();
  for (const path of ["bil/modules/core/calculation.bil.json", "bil/modules/science/force.bil.json", "bil/modules/workflows/force-plot.bil.json"]) registry.register(parseBilModule(readFileSync(path, "utf8")));
  return registry;
}

test("calculation BIL resolution matches authoritative planIntent capabilities", async () => {
  const semantic = createSemanticObject(await mockSemanticInterpreter({ text: "Calculate 25 * 48." }));
  const registries = createDefaultRegistries();
  const authoritative = planIntent(semantic, registries);
  const resolution = resolveBil(bilRegistry(), {
    intents: [semantic.intent], concepts: semantic.concepts, relationships: semantic.relationships,
    requestedOutputs: semantic.requestedOutputs, modality: semantic.modality, context: semantic.context,
  });
  assert.deepEqual(resolution.requiredCapabilityIds, authoritative.capabilities);
  assert.deepEqual(resolution.selectedModuleIds, ["bil.core.calculation"]);
});

test("force-plot BIL resolution matches authoritative capabilities and workflow dependencies", async () => {
  const semantic = createSemanticObject(await mockSemanticInterpreter({ text: "Plot force as mass changes from 1 to 10 kg with acceleration 5 m/s2." }));
  const registries = createDefaultRegistries();
  const authoritative = planIntent(semantic, registries);
  const registry = bilRegistry();
  const resolution = resolveBil(registry, {
    intents: [semantic.intent], concepts: semantic.concepts, relationships: semantic.relationships,
    requestedOutputs: semantic.requestedOutputs, modality: semantic.modality, context: semantic.context,
  });
  const workflow = registry.get("bil.workflow.force_plot")?.workflow;
  assert.deepEqual(resolution.requiredCapabilityIds, authoritative.capabilities);
  assert.deepEqual(workflow?.steps.map(({ id, dependsOn = [] }) => ({ id, dependsOn })), authoritative.steps.filter(({ capability }: { capability?: string }) => capability).map(({ id, dependsOn = [] }: { id: string; dependsOn?: string[] }) => ({ id, dependsOn })));
});
