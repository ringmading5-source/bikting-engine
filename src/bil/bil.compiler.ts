import { CapabilityRegistry } from "../capabilities/capability.registry";
import { Capability } from "../capabilities/capability.types";
import { BiktingGraph } from "../core/graph";
import { RelationshipTypeRegistry } from "../core/relationship.registry";
import { Relationship } from "../core/types";
import { UserIntent } from "../intent/intent.types";
import { KnowledgeConcept, KnowledgeModule } from "../knowledge/knowledge.types";
import { BilCompilationError } from "./bil.errors";
import { BilRegistry } from "./bil.registry";
import {
  BilCompilationIssue, BilCompiledCapabilityRequirement, BilCompiledRequirement, BilCompiledWorkflow,
  BilConflict, BilContext, BilModule, BilProvenance, BilResolution,
} from "./bil.types";

export interface BilCompilerInput {
  intent: UserIntent;
  resolution: BilResolution;
  modules: BilModule[];
  capabilityRegistry: CapabilityRegistry;
  relationshipTypeRegistry: RelationshipTypeRegistry;
  bilRegistry?: BilRegistry;
  knowledgeModules?: KnowledgeModule[];
}

/** Compiles declarative BIL into canonical, immutable planning context. */
export class BilCompiler {
  compile(input: BilCompilerInput): BilContext {
    const issues: BilCompilationIssue[] = [];
    const modules = resolveAndOrderModules(input.modules, input.bilRegistry, issues);
    const conflicts = detectConflicts(modules);
    if (issues.length || conflicts.length) throw new BilCompilationError(issues, conflicts);

    const concepts = compileConcepts(modules);
    const relationships = compileRelationships(modules, input.relationshipTypeRegistry, issues);
    if (issues.length) throw new BilCompilationError(issues);
    const knowledgeModules = compileKnowledgeModules(modules, concepts, relationships, input.knowledgeModules ?? []);
    const graph = compileGraph(knowledgeModules, input.relationshipTypeRegistry);
    const capabilityRequirements = compileCapabilities(modules, input.capabilityRegistry, issues);
    const knowledgeRequirements = compileDeclarations(modules, "knowledgeRequirements", "knowledge_requirement", ({ id }) => id);
    const capabilities = uniqueBy(capabilityRequirements.flatMap(({ capability }) => capability ? [capability] : []), ({ id }) => id);
    const workflows = compileWorkflows(modules, input.capabilityRegistry, issues);
    const sourceModules = modules.map(({ id, version }) => ({ id, version }));
    const relationshipTypes = uniqueBy(relationships.map(({ type }) => input.relationshipTypeRegistry.assert(type)), ({ id }) => id);
    const reasoningStrategies = compileDeclarations(modules, "reasoningStrategies", "reasoning_strategy", ({ id }) => id);
    const constraints = compileDeclarations(modules, "constraints", "constraint", ({ type }) => type);
    const executionRequirements = compileDeclarations(modules, "executionRequirements", "execution_requirement", ({ id }) => id);
    const verificationRequirements = compileDeclarations(modules, "verificationRequirements", "verification_requirement", ({ id }) => id);
    const outputRequirements = compileDeclarations(modules, "outputRequirements", "output_requirement", ({ id }) => id);
    const compiledProvenance: BilProvenance[] = [
      ...concepts.map((concept) => concept.metadata?.bilProvenance as BilProvenance),
      ...relationships.map((relationship) => relationship.metadata?.bilProvenance as BilProvenance),
      ...reasoningStrategies.flatMap(({ provenance }) => provenance), ...capabilityRequirements.flatMap(({ provenance }) => provenance),
      ...knowledgeRequirements.flatMap(({ provenance }) => provenance),
      ...workflows.flatMap((workflow) => [...workflow.provenance, ...workflow.steps.flatMap(({ provenance }) => provenance)]),
      ...constraints.flatMap(({ provenance }) => provenance), ...executionRequirements.flatMap(({ provenance }) => provenance),
      ...verificationRequirements.flatMap(({ provenance }) => provenance), ...outputRequirements.flatMap(({ provenance }) => provenance),
      ...modules.flatMap((module) => (module.moduleReferences ?? []).map((reference) => provenance(module, "module_reference", reference.moduleId))),
    ];
    const context: BilContext = {
      id: contextId(input.intent, sourceModules),
      resolutionId: input.resolution.id,
      intent: clone(input.intent), sourceModules, concepts, relationships, relationshipTypes,
      knowledgeModules, graph, reasoningStrategies,
      requiredCapabilityIds: unique(capabilityRequirements.filter(({ declaration }) => declaration.required).map(({ declaration }) => declaration.capabilityId)),
      capabilities, capabilityRequirements, knowledgeRequirements, workflows, constraints, executionRequirements,
      verificationRequirements, outputRequirements, unresolvedReferences: issues, provenance: compiledProvenance,
    };
    return deepFreeze(context);
  }
}

function resolveAndOrderModules(selected: BilModule[], registry: BilRegistry | undefined, issues: BilCompilationIssue[]): BilModule[] {
  const modules = new Map(selected.map((module) => [module.id, module]));
  const visitReferences = (module: BilModule): void => {
    for (const reference of module.moduleReferences ?? []) {
      if (!isVersionConstraint(reference.version)) { issues.push({ type: "invalid_version", moduleIds: [module.id], reference: reference.moduleId, reason: `Invalid version constraint ${reference.version} in ${module.id}.` }); continue; }
      const target = registry?.get(reference.moduleId) ?? modules.get(reference.moduleId);
      if (!target) { issues.push({ type: "missing_module", moduleIds: [module.id], reference: reference.moduleId, reason: `Module ${module.id} references missing module ${reference.moduleId}.` }); continue; }
      if (!versionSatisfies(target.version, reference.version)) { issues.push({ type: "incompatible_version", moduleIds: [module.id, target.id], reference: reference.version, reason: `${target.id}@${target.version} does not satisfy ${reference.version} required by ${module.id}.` }); continue; }
      if (!modules.has(target.id)) { modules.set(target.id, target); visitReferences(target); }
    }
  };
  selected.forEach(visitReferences);
  const state = new Map<string, "visiting" | "visited">(); const ordered: BilModule[] = [];
  const visit = (module: BilModule, path: string[]): void => {
    if (state.get(module.id) === "visited") return;
    if (state.get(module.id) === "visiting") { issues.push({ type: "circular_module_dependency", moduleIds: [...path, module.id], reason: `Circular BIL module dependency: ${[...path, module.id].join(" -> ")}.` }); return; }
    state.set(module.id, "visiting");
    const dependencies = (module.moduleReferences ?? []).map(({ moduleId }) => modules.get(moduleId)).filter((item): item is BilModule => Boolean(item)).sort(compareModules);
    dependencies.forEach((dependency) => visit(dependency, [...path, module.id]));
    state.set(module.id, "visited"); ordered.push(module);
  };
  [...modules.values()].sort(compareModules).forEach((module) => visit(module, []));
  return uniqueBy(ordered, ({ id }) => id);
}

function compileConcepts(modules: BilModule[]): KnowledgeConcept[] {
  const concepts = modules.flatMap((module) => module.concepts.map((concept) => ({
    id: concept.id, kind: "concept" as const, name: concept.name ?? concept.id, description: concept.description,
    content: { definition: concept.description }, metadata: { bilProvenance: [provenance(module, "concept", concept.id)] },
  })));
  return mergeCanonical(concepts, (item) => item.id).map(deepFreeze);
}

function compileRelationships(modules: BilModule[], types: RelationshipTypeRegistry, issues: BilCompilationIssue[]): Relationship[] {
  const relationships = modules.flatMap((module) => module.relationships.map((relationship) => {
    if (!types.has(relationship.type)) issues.push({ type: "unknown_relationship_type", moduleIds: [module.id], reference: relationship.type, reason: `Unknown relationship type ${relationship.type} in ${module.id}.` });
    return { ...clone(relationship), source: `${module.id}@${module.version}`, metadata: { ...(relationship.metadata ?? {}), bilProvenance: [provenance(module, "relationship", relationship.id)] } };
  }));
  return mergeCanonical(relationships, ({ id }) => id).map(deepFreeze);
}

function compileKnowledgeModules(modules: BilModule[], concepts: KnowledgeConcept[], relationships: Relationship[], additional: KnowledgeModule[]): KnowledgeModule[] {
  const compiled = modules.filter((module) => module.concepts.length || module.relationships.length).map((module) => deepFreeze({
    id: `knowledge.${module.id}`, name: module.name, domain: typeof module.metadata?.domain === "string" ? module.metadata.domain : undefined,
    concepts: concepts.filter((concept) => (concept.metadata?.bilProvenance as BilProvenance[])?.some(({ moduleId }) => moduleId === module.id)),
    relationships: relationships.filter((relationship) => (relationship.metadata?.bilProvenance as BilProvenance[])?.some(({ moduleId }) => moduleId === module.id)),
    sources: [{ source: module.id, evidence: `BIL module ${module.id}@${module.version}` }], metadata: { bilModuleId: module.id, bilModuleVersion: module.version },
  }));
  return [...compiled, ...additional.map((module) => deepFreeze(clone(module)))];
}

function compileGraph(modules: KnowledgeModule[], types: RelationshipTypeRegistry): BiktingGraph {
  const graph = new BiktingGraph();
  for (const module of modules) for (const concept of module.concepts) if (!graph.getEntity(concept.id)) graph.addEntity(concept);
  for (const module of modules) for (const relationship of module.relationships) { types.assert(relationship.type); if (!graph.getRelationship(relationship.id)) graph.addRelationship(relationship); }
  graph.seal();
  Object.freeze(graph);
  return graph;
}

function compileCapabilities(modules: BilModule[], registry: CapabilityRegistry, issues: BilCompilationIssue[]): BilCompiledCapabilityRequirement[] {
  const compiled = modules.flatMap((module) => module.capabilityRequirements.map((declaration) => {
    const capability = registry.get(declaration.capabilityId);
    if (!capability) issues.push({ type: "unknown_capability", moduleIds: [module.id], reference: declaration.capabilityId, reason: `Unknown canonical capability ${declaration.capabilityId} required by ${module.id}.` });
    return deepFreeze({ declaration: clone(declaration), capability: capability ? clone(capability) : undefined, provenance: [provenance(module, "capability_requirement", declaration.capabilityId)] });
  }));
  return mergeCompiled(compiled, ({ declaration }) => declaration.capabilityId);
}

function compileWorkflows(modules: BilModule[], registry: CapabilityRegistry, issues: BilCompilationIssue[]): BilCompiledWorkflow[] {
  const workflows = modules.flatMap((module) => module.workflow ? [{
    id: module.workflow.id, provenance: [provenance(module, "workflow", module.workflow.id)],
    steps: module.workflow.steps.map((step) => {
      if (!registry.has(step.capabilityId)) issues.push({ type: "missing_workflow_capability", moduleIds: [module.id], reference: step.capabilityId, reason: `Workflow ${module.workflow?.id} references unknown canonical capability ${step.capabilityId}.` });
      return { ...clone(step), dependsOn: [...(step.dependsOn ?? [])], provenance: [provenance(module, "workflow_step", step.id)] };
    }),
  }] : []);
  const grouped = new Map<string, BilCompiledWorkflow>();
  for (const workflow of workflows) {
    const existing = grouped.get(workflow.id);
    if (!existing) { grouped.set(workflow.id, workflow); continue; }
    grouped.set(workflow.id, { ...existing, provenance: [...existing.provenance, ...workflow.provenance], steps: existing.steps.map((step, index) => ({ ...step, provenance: [...step.provenance, ...(workflow.steps[index]?.provenance ?? [])] })) });
  }
  return [...grouped.values()].map(deepFreeze);
}

function compileDeclarations<K extends "reasoningStrategies" | "constraints" | "executionRequirements" | "verificationRequirements" | "outputRequirements" | "knowledgeRequirements">(
  modules: BilModule[], key: K, category: BilProvenance["category"], id: (item: BilModule[K][number]) => string,
): BilCompiledRequirement<BilModule[K][number]>[] {
  const compiled = modules.flatMap((module) => (module[key] ?? []).map((declaration) => deepFreeze({ declaration: clone(declaration), provenance: [provenance(module, category, id(declaration))] })));
  return mergeCompiled(compiled, ({ declaration }) => id(declaration)) as BilCompiledRequirement<BilModule[K][number]>[];
}

export function detectConflicts(modules: BilModule[]): BilConflict[] {
  return [
    ...conflictsFor(modules, "constraints", "constraint", ({ type }) => type),
    ...conflictsFor(modules, "capabilityRequirements", "capability_requirement", ({ capabilityId }) => capabilityId, ({ required }) => ({ required })),
    ...conflictsFor(modules.filter(({ workflow }) => workflow), "workflow", "workflow", (workflow) => workflow?.id ?? ""),
    ...conflictsFor(modules, "concepts", "concept", ({ id }) => id),
    ...conflictsFor(modules, "relationships", "relationship", ({ id }) => id),
    ...conflictsFor(modules, "outputRequirements", "output_requirement", ({ id }) => id),
    ...conflictsFor(modules, "knowledgeRequirements", "knowledge_requirement", ({ id }) => id),
  ];
}

function conflictsFor<K extends "constraints" | "capabilityRequirements" | "knowledgeRequirements" | "workflow" | "concepts" | "relationships" | "outputRequirements">(
  modules: BilModule[], key: K, type: BilConflict["type"], identity: (item: NonNullable<BilModule[K]> extends Array<infer T> ? T : NonNullable<BilModule[K]>) => string,
  comparable: (item: NonNullable<BilModule[K]> extends Array<infer T> ? T : NonNullable<BilModule[K]>) => unknown = (item) => item,
): BilConflict[] {
  const declarations = new Map<string, Array<{ module: BilModule; value: unknown }>>();
  for (const module of modules) {
    const values = key === "workflow" ? (module.workflow ? [module.workflow] : []) : module[key] as unknown[];
    for (const value of values) { const id = identity(value as never); const entries = declarations.get(id) ?? []; entries.push({ module, value }); declarations.set(id, entries); }
  }
  return [...declarations.entries()].flatMap(([id, entries]) => {
    const forms = new Set(entries.map(({ value }) => stableStringify(comparable(value as never))));
    return forms.size > 1 ? [{ type, modules: entries.map(({ module }) => ({ id: module.id, version: module.version })), declarations: entries.map(({ value }) => value), reason: `Conflicting ${type} declaration ${id} across modules ${entries.map(({ module }) => module.id).join(", ")}.` }] : [];
  });
}

function provenance(module: BilModule, category: BilProvenance["category"], declarationId?: string): BilProvenance { return { moduleId: module.id, moduleVersion: module.version, category, declarationId }; }
function compareModules(left: BilModule, right: BilModule): number { const specificity = specificityOf(right) - specificityOf(left); const kinds = ["constraint", "knowledge", "reasoning", "capability", "workflow", "output"]; return specificity || kinds.indexOf(left.kind) - kinds.indexOf(right.kind) || left.id.localeCompare(right.id); }
function specificityOf(module: BilModule): number { return Object.values(module.appliesWhen).reduce<number>((score, value) => score + (Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : 0), 0); }
function isVersionConstraint(value: string): boolean { return /^(?:\^)?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(value); }
function versionSatisfies(actual: string, constraint: string): boolean { if (!isVersionConstraint(actual) || !isVersionConstraint(constraint)) return false; if (!constraint.startsWith("^")) return actual === constraint; const [major, minor, patch] = actual.split("-")[0].split(".").map(Number); const [requiredMajor, requiredMinor, requiredPatch] = constraint.slice(1).split("-")[0].split(".").map(Number); return major === requiredMajor && (minor > requiredMinor || (minor === requiredMinor && patch >= requiredPatch)); }
function contextId(intent: UserIntent, modules: Array<{ id: string; version: string }>): string { return `bil-context-${hash(stableStringify({ intent, modules }))}`; }
function hash(value: string): string { let result = 2166136261; for (let index = 0; index < value.length; index += 1) { result ^= value.charCodeAt(index); result = Math.imul(result, 16777619); } return (result >>> 0).toString(16).padStart(8, "0"); }
function stableStringify(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`; return JSON.stringify(value); }
function clone<T>(value: T): T { return structuredClone(value); }
function unique<T>(items: T[]): T[] { return [...new Set(items)]; }
function uniqueBy<T>(items: T[], key: (item: T) => string): T[] { return [...new Map(items.map((item) => [key(item), item])).values()]; }
function mergeCompiled<T extends { provenance: readonly BilProvenance[] }>(items: T[], key: (item: T) => string): T[] { const result = new Map<string, T>(); for (const item of items) { const id = key(item); const existing = result.get(id); result.set(id, existing ? { ...existing, provenance: [...existing.provenance, ...item.provenance] } : item); } return [...result.values()].map(deepFreeze); }
function mergeCanonical<T extends { metadata?: Record<string, unknown> }>(items: T[], key: (item: T) => string): T[] { const result = new Map<string, T>(); for (const item of items) { const id = key(item); const existing = result.get(id); if (!existing) result.set(id, item); else result.set(id, { ...existing, metadata: { ...(existing.metadata ?? {}), bilProvenance: [...((existing.metadata?.bilProvenance as BilProvenance[]) ?? []), ...((item.metadata?.bilProvenance as BilProvenance[]) ?? [])] } }); } return [...result.values()]; }
function deepFreeze<T>(value: T): T { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; if (value instanceof Map || value instanceof Set) return Object.freeze(value); for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item); return Object.freeze(value); }
