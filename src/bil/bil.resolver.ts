import { BilRegistry } from "./bil.registry";
import { BilApplicability, BilModule, BilResolution, BilResolutionInput, BilUnresolvedRequirement } from "./bil.types";

/** Deterministically resolves validated modules from structured semantic input only. */
export function resolveBil(registry: BilRegistry, input: BilResolutionInput): BilResolution {
  const selections = registry.list().flatMap((module) => {
    const reasons = matchReasons(module.appliesWhen, input);
    return reasons ? [{ module, reasons }] : [];
  }).sort((left, right) => compareModules(left.module, right.module));
  const modules = selections.map(({ module }) => module);
  const requiredCapabilityIds = unique(modules.flatMap((module) => module.capabilityRequirements.filter(({ required }) => required).map(({ capabilityId }) => capabilityId)));
  const outputRequirements = uniqueBy(modules.flatMap((module) => module.outputRequirements), (item) => item.id);
  const unresolvedRequirements: BilUnresolvedRequirement[] = [];
  const declaredCapabilities = new Set(modules.flatMap((module) => module.capabilityRequirements.map(({ capabilityId }) => capabilityId)));
  const suppliedOutputs = new Set(outputRequirements.map(({ type }) => type));
  for (const id of input.requestedCapabilityIds ?? []) if (!declaredCapabilities.has(id)) unresolvedRequirements.push({ kind: "capability", id, reason: "No selected BIL module declares the requested capability." });
  for (const id of input.requestedOutputs ?? []) if (!suppliedOutputs.has(id)) unresolvedRequirements.push({ kind: "output", id, reason: "No selected BIL module declares the requested output." });
  if (input.availableCapabilityIds) {
    const available = new Set(input.availableCapabilityIds);
    for (const id of requiredCapabilityIds) if (!available.has(id)) unresolvedRequirements.push({ kind: "capability", id, reason: "The required capability is not present in the supplied availability context." });
  }
  const resolution = {
    id: "",
    selectedModuleIds: modules.map(({ id }) => id),
    selectedModuleVersions: modules.map(({ id, version }) => ({ moduleId: id, version })),
    selections: selections.map(({ module, reasons }) => ({ moduleId: module.id, version: module.version, reasons })),
    requiredCapabilityIds,
    relevantRelationships: uniqueBy(modules.flatMap(({ relationships }) => relationships), ({ id }) => id),
    constraints: uniqueBy([...(input.constraints ?? []), ...modules.flatMap(({ constraints }) => constraints)], (item) => JSON.stringify(item)),
    executionRequirements: uniqueBy(modules.flatMap(({ executionRequirements }) => executionRequirements), ({ id }) => id),
    verificationRequirements: uniqueBy(modules.flatMap(({ verificationRequirements }) => verificationRequirements), ({ id }) => id),
    outputRequirements,
    unresolvedRequirements: uniqueBy(unresolvedRequirements, (item) => `${item.kind}:${item.id}:${item.reason}`),
  };
  resolution.id = `bil-resolution-${hash(stableStringify({ input: normalizedResolutionInput(input), modules: resolution.selectedModuleVersions }))}`;
  return resolution;
}

function compareModules(left: BilModule, right: BilModule): number {
  const specificity = conditionSpecificity(right.appliesWhen) - conditionSpecificity(left.appliesWhen);
  if (specificity) return specificity;
  const kindOrder = ["constraint", "knowledge", "reasoning", "capability", "workflow", "output"];
  const kind = kindOrder.indexOf(left.kind) - kindOrder.indexOf(right.kind);
  return kind || left.id.localeCompare(right.id);
}
function conditionSpecificity(condition: BilApplicability): number {
  return Object.entries(condition).reduce((score, [, value]) => score + (Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : value === undefined ? 0 : 1), 0);
}

function matchReasons(condition: BilApplicability, input: BilResolutionInput): string[] | null {
  const reasons: string[] = [];
  const intents = new Set(input.intents); const concepts = new Set(input.concepts ?? []); const capabilities = new Set(input.requestedCapabilityIds ?? []); const outputs = new Set(input.requestedOutputs ?? []);
  if (condition.intents?.length) { const matches = condition.intents.filter((id) => intents.has(id)); if (!matches.length) return null; reasons.push(`intent:${matches.join(",")}`); }
  if (!all(condition.allConcepts, concepts)) return null; if (condition.allConcepts?.length) reasons.push(`all-concepts:${condition.allConcepts.join(",")}`);
  if (!any(condition.anyConcepts, concepts)) return null; if (condition.anyConcepts?.length) reasons.push(`any-concept:${condition.anyConcepts.filter((id) => concepts.has(id)).join(",")}`);
  if (!all(condition.allRequestedCapabilities, capabilities)) return null; if (condition.allRequestedCapabilities?.length) reasons.push(`all-capabilities:${condition.allRequestedCapabilities.join(",")}`);
  if (!any(condition.anyRequestedCapabilities, capabilities)) return null; if (condition.anyRequestedCapabilities?.length) reasons.push(`any-capability:${condition.anyRequestedCapabilities.filter((id) => capabilities.has(id)).join(",")}`);
  if (!all(condition.allRequestedOutputs, outputs)) return null; if (condition.allRequestedOutputs?.length) reasons.push(`all-outputs:${condition.allRequestedOutputs.join(",")}`);
  if (!any(condition.anyRequestedOutputs, outputs)) return null; if (condition.anyRequestedOutputs?.length) reasons.push(`any-output:${condition.anyRequestedOutputs.filter((id) => outputs.has(id)).join(",")}`);
  if (condition.modalities?.length) { if (!input.modality || !condition.modalities.includes(input.modality)) return null; reasons.push(`modality:${input.modality}`); }
  for (const [key, value] of Object.entries(condition.contextEquals ?? {})) { if (input.context?.[key] !== value) return null; reasons.push(`context:${key}=${String(value)}`); }
  for (const expected of condition.relationships ?? []) { if (!(input.relationships ?? []).some((actual) => actual.type === expected.type && (!expected.from || actual.from === expected.from) && (!expected.to || actual.to === expected.to))) return null; reasons.push(`relationship:${expected.type}`); }
  return reasons.length ? reasons : null;
}

function all(expected: string[] | undefined, actual: Set<string>): boolean { return !expected?.length || expected.every((item) => actual.has(item)); }
function any(expected: string[] | undefined, actual: Set<string>): boolean { return !expected?.length || expected.some((item) => actual.has(item)); }
function unique<T>(items: T[]): T[] { return [...new Set(items)]; }
function uniqueBy<T>(items: T[], key: (item: T) => string): T[] { return [...new Map(items.map((item) => [key(item), item])).values()]; }
function normalizedResolutionInput(input: BilResolutionInput): unknown { return { ...input, intents: [...input.intents].sort(), concepts: [...(input.concepts ?? [])].sort(), requestedCapabilityIds: [...(input.requestedCapabilityIds ?? [])].sort(), availableCapabilityIds: input.availableCapabilityIds ? [...input.availableCapabilityIds].sort() : undefined, requestedOutputs: [...(input.requestedOutputs ?? [])].sort() }; }
function stableStringify(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`; return JSON.stringify(value); }
function hash(value: string): string { let result = 2166136261; for (let index = 0; index < value.length; index += 1) { result ^= value.charCodeAt(index); result = Math.imul(result, 16777619); } return (result >>> 0).toString(16).padStart(8, "0"); }
