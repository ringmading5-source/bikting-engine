import { BilValidationError, BilValidationIssue } from "./bil.errors";
import { BilModule, BilModuleKind } from "./bil.types";

const kinds = new Set<BilModuleKind>(["reasoning", "knowledge", "capability", "workflow", "output", "constraint"]);
const strategyTypes = new Set(["deterministic", "model_assisted", "retrieve_then_reason"]);
const idPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

export function validateBilStructure(value: unknown): BilValidationIssue[] {
  const issues: BilValidationIssue[] = [];
  if (!isRecord(value)) return [issue("structural", "$", "BIL document must be a JSON object.")];
  const allowedRoot = new Set(["id", "version", "kind", "name", "description", "appliesWhen", "intents", "concepts", "relationships", "reasoningStrategies", "capabilityRequirements", "knowledgeRequirements", "workflow", "constraints", "executionRequirements", "verificationRequirements", "outputRequirements", "moduleReferences", "metadata"]);
  for (const key of Object.keys(value)) if (!allowedRoot.has(key)) issues.push(issue("structural", `$.${key}`, "Unknown top-level field."));
  requiredString(value, "id", issues);
  requiredString(value, "version", issues);
  requiredString(value, "kind", issues);
  requiredString(value, "name", issues);
  requiredString(value, "description", issues);
  requiredRecord(value, "appliesWhen", issues);
  for (const field of ["intents", "concepts", "relationships", "reasoningStrategies", "capabilityRequirements", "constraints", "executionRequirements", "verificationRequirements", "outputRequirements"]) requiredArray(value, field, issues);
  if (value.workflow !== undefined && !isRecord(value.workflow)) issues.push(issue("structural", "$.workflow", "workflow must be an object."));
  if (value.metadata !== undefined && !isRecord(value.metadata)) issues.push(issue("structural", "$.metadata", "metadata must be an object."));
  validateStringArrayFields(value.appliesWhen, "$.appliesWhen", ["intents", "allConcepts", "anyConcepts", "allRequestedCapabilities", "anyRequestedCapabilities", "allRequestedOutputs", "anyRequestedOutputs", "modalities"], issues);
  validateObjectArray(value.concepts, "$.concepts", issues);
  validateObjectArray(value.relationships, "$.relationships", issues);
  validateObjectArray(value.reasoningStrategies, "$.reasoningStrategies", issues);
  validateObjectArray(value.capabilityRequirements, "$.capabilityRequirements", issues);
  validateObjectArray(value.knowledgeRequirements, "$.knowledgeRequirements", issues);
  validateObjectArray(value.constraints, "$.constraints", issues);
  validateObjectArray(value.executionRequirements, "$.executionRequirements", issues);
  validateObjectArray(value.verificationRequirements, "$.verificationRequirements", issues);
  validateObjectArray(value.outputRequirements, "$.outputRequirements", issues);
  validateEntries(value.concepts, "$.concepts", { id: "string", name: "optionalString", description: "optionalString" }, issues);
  validateEntries(value.relationships, "$.relationships", { id: "string", type: "string", from: "string", to: "string" }, issues);
  validateEntries(value.reasoningStrategies, "$.reasoningStrategies", { id: "string", type: "string", description: "optionalString", requiredContext: "optionalStringArray" }, issues);
  validateEntries(value.capabilityRequirements, "$.capabilityRequirements", { capabilityId: "string", required: "boolean", purpose: "optionalString" }, issues);
  if (value.knowledgeRequirements !== undefined && !Array.isArray(value.knowledgeRequirements)) issues.push(issue("structural", "$.knowledgeRequirements", "knowledgeRequirements must be an array."));
  validateEntries(value.knowledgeRequirements, "$.knowledgeRequirements", { id: "string", domain: "optionalString", concepts: "stringArray", relationshipTypes: "optionalStringArray", freshness: "string", required: "boolean" }, issues);
  validateEntries(value.constraints, "$.constraints", { type: "string", value: "present" }, issues);
  validateEntries(value.executionRequirements, "$.executionRequirements", { id: "string", type: "string", required: "optionalBoolean" }, issues);
  validateEntries(value.verificationRequirements, "$.verificationRequirements", { id: "string", method: "string", capabilityId: "optionalString", required: "boolean", description: "optionalString" }, issues);
  validateEntries(value.outputRequirements, "$.outputRequirements", { id: "string", type: "string", capabilityId: "optionalString", required: "boolean" }, issues);
  if (value.moduleReferences !== undefined && !Array.isArray(value.moduleReferences)) issues.push(issue("structural", "$.moduleReferences", "moduleReferences must be an array."));
  validateEntries(value.moduleReferences, "$.moduleReferences", { moduleId: "string", version: "string" }, issues);
  if (isRecord(value.appliesWhen)) {
    if (value.appliesWhen.contextEquals !== undefined && !isRecord(value.appliesWhen.contextEquals)) issues.push(issue("structural", "$.appliesWhen.contextEquals", "contextEquals must be an object."));
    validateEntries(value.appliesWhen.relationships, "$.appliesWhen.relationships", { type: "string", from: "optionalString", to: "optionalString" }, issues);
  }
  if (isRecord(value.workflow)) {
    if (typeof value.workflow.id !== "string") issues.push(issue("structural", "$.workflow.id", "workflow id must be a string."));
    if (!Array.isArray(value.workflow.steps)) issues.push(issue("structural", "$.workflow.steps", "workflow steps must be an array."));
    validateEntries(value.workflow.steps, "$.workflow.steps", { id: "string", capabilityId: "string", dependsOn: "optionalStringArray", description: "optionalString" }, issues);
    if (Array.isArray(value.workflow.steps)) value.workflow.steps.forEach((step, index) => {
      if (!isRecord(step) || step.inputBindings === undefined) return;
      if (!Array.isArray(step.inputBindings)) { issues.push(issue("structural", `$.workflow.steps[${index}].inputBindings`, "inputBindings must be an array.")); return; }
      step.inputBindings.forEach((binding, bindingIndex) => {
        const path = `$.workflow.steps[${index}].inputBindings[${bindingIndex}]`;
        if (!isRecord(binding) || typeof binding.target !== "string" || !isRecord(binding.source) || !["intent", "context", "literal", "step_output"].includes(String(binding.source.type))) issues.push(issue("structural", path, "Invalid declarative input binding."));
        if (isRecord(binding?.source) && binding.source.type !== "literal" && (!Array.isArray(binding.source.path) || binding.source.path.some((item: unknown) => typeof item !== "string" || !item))) issues.push(issue("structural", `${path}.source.path`, "Binding path must be an array of non-empty strings."));
      });
    });
  }
  return issues;
}

export function validateBilSemantics(module: BilModule): BilValidationIssue[] {
  const issues: BilValidationIssue[] = [];
  if (!idPattern.test(module.id)) issues.push(issue("semantic", "$.id", "id must be a stable lowercase identifier."));
  if (!versionPattern.test(module.version)) issues.push(issue("semantic", "$.version", "version must use semantic versioning."));
  if (!kinds.has(module.kind)) issues.push(issue("semantic", "$.kind", `Unrecognized module kind: ${module.kind}.`));
  validateUniqueStrings(module.intents, "$.intents", issues);
  validateIdentifiers(module.intents, "$.intents", issues);
  validateDeclarations(module.concepts, "id", "$.concepts", issues);
  validateDeclarations(module.relationships, "id", "$.relationships", issues);
  validateDeclarations(module.reasoningStrategies, "id", "$.reasoningStrategies", issues);
  validateDeclarations(module.capabilityRequirements, "capabilityId", "$.capabilityRequirements", issues);
  validateDeclarations(module.knowledgeRequirements ?? [], "id", "$.knowledgeRequirements", issues);
  for (const [index, requirement] of (module.knowledgeRequirements ?? []).entries()) if (!["stable", "recent", "live", "project_current"].includes(requirement.freshness)) issues.push(issue("semantic", `$.knowledgeRequirements[${index}].freshness`, "Unsupported knowledge freshness."));
  validateDeclarations(module.executionRequirements, "id", "$.executionRequirements", issues);
  validateDeclarations(module.verificationRequirements, "id", "$.verificationRequirements", issues);
  validateDeclarations(module.outputRequirements, "id", "$.outputRequirements", issues);
  validateDeclarations(module.moduleReferences ?? [], "moduleId", "$.moduleReferences", issues);
  validateApplicability(module, issues);

  const concepts = new Set(module.concepts.map(({ id }) => id));
  for (const [index, relationship] of module.relationships.entries()) {
    if (!idPattern.test(relationship.type)) issues.push(issue("semantic", `$.relationships[${index}].type`, "relationship type must be a stable identifier."));
    if (!concepts.has(relationship.from) || !concepts.has(relationship.to)) issues.push(issue("semantic", `$.relationships[${index}]`, "relationship endpoints must reference concepts declared by the module."));
  }
  for (const [index, strategy] of module.reasoningStrategies.entries()) {
    if (!strategyTypes.has(strategy.type)) issues.push(issue("semantic", `$.reasoningStrategies[${index}].type`, `Unsupported reasoning strategy: ${strategy.type}.`));
  }
  validateWorkflow(module, issues);
  return issues;
}

export function assertValidBilModule(value: unknown): BilModule {
  const structural = validateBilStructure(value);
  if (structural.length) throw new BilValidationError(structural);
  const module = value as unknown as BilModule;
  const semantic = validateBilSemantics(module);
  if (semantic.length) throw new BilValidationError(semantic);
  return module;
}

function validateApplicability(module: BilModule, issues: BilValidationIssue[]): void {
  const condition = module.appliesWhen;
  const supported = new Set(["intents", "allConcepts", "anyConcepts", "allRequestedCapabilities", "anyRequestedCapabilities", "allRequestedOutputs", "anyRequestedOutputs", "modalities", "contextEquals", "relationships"]);
  for (const key of Object.keys(condition)) if (!supported.has(key)) issues.push(issue("semantic", `$.appliesWhen.${key}`, "Unsupported condition; executable or unknown conditions are not allowed."));
  const conditionArrays = [condition.intents, condition.allConcepts, condition.anyConcepts, condition.allRequestedCapabilities, condition.anyRequestedCapabilities, condition.allRequestedOutputs, condition.anyRequestedOutputs, condition.modalities];
  if (!conditionArrays.some((items) => items?.length) && !Object.keys(condition.contextEquals ?? {}).length && !condition.relationships?.length) issues.push(issue("semantic", "$.appliesWhen", "At least one deterministic applicability condition is required."));
  for (const [key, value] of Object.entries(condition.contextEquals ?? {})) {
    if (!key || !isPrimitive(value)) issues.push(issue("semantic", `$.appliesWhen.contextEquals.${key}`, "context equality values must be JSON primitives."));
  }
}

function validateWorkflow(module: BilModule, issues: BilValidationIssue[]): void {
  if (!module.workflow) return;
  if (!idPattern.test(module.workflow.id) || !Array.isArray(module.workflow.steps) || !module.workflow.steps.length) {
    issues.push(issue("semantic", "$.workflow", "workflow needs a stable id and at least one step."));
    return;
  }
  validateDeclarations(module.workflow.steps, "id", "$.workflow.steps", issues);
  const steps = new Map(module.workflow.steps.map((step) => [step.id, step]));
  const capabilities = new Set(module.capabilityRequirements.map(({ capabilityId }) => capabilityId));
  for (const [index, step] of module.workflow.steps.entries()) {
    if (!capabilities.has(step.capabilityId)) issues.push(issue("semantic", `$.workflow.steps[${index}].capabilityId`, "workflow capability must be declared in capabilityRequirements."));
    for (const dependency of step.dependsOn ?? []) if (!steps.has(dependency)) issues.push(issue("semantic", `$.workflow.steps[${index}].dependsOn`, `Unknown workflow step: ${dependency}.`));
    if ((step.dependsOn ?? []).includes(step.id)) issues.push(issue("semantic", `$.workflow.steps[${index}].dependsOn`, "A workflow step cannot depend on itself."));
    const targets = new Set<string>();
    for (const binding of step.inputBindings ?? []) {
      if (targets.has(binding.target)) issues.push(issue("semantic", `$.workflow.steps[${index}].inputBindings`, `Duplicate binding target: ${binding.target}.`));
      targets.add(binding.target);
      if (binding.source.type === "step_output" && !steps.has(binding.source.stepId)) issues.push(issue("semantic", `$.workflow.steps[${index}].inputBindings`, `Unknown binding step: ${binding.source.stepId}.`));
      if (binding.source.type === "literal" && !isJsonValue(binding.source.value)) issues.push(issue("semantic", `$.workflow.steps[${index}].inputBindings`, "Literal binding must contain inert JSON data."));
    }
  }
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) { issues.push(issue("semantic", "$.workflow.steps", `Workflow dependency cycle at ${id}.`)); return; }
    visiting.add(id);
    for (const dependency of steps.get(id)?.dependsOn ?? []) if (steps.has(dependency)) visit(dependency);
    visiting.delete(id); visited.add(id);
  };
  for (const id of steps.keys()) visit(id);
}

function validateDeclarations(items: unknown[], key: string, path: string, issues: BilValidationIssue[]): void {
  const values: string[] = [];
  items.forEach((item, index) => {
    if (!isRecord(item) || typeof item[key] !== "string" || !idPattern.test(item[key] as string)) issues.push(issue("semantic", `${path}[${index}].${key}`, "A stable identifier is required."));
    else values.push(item[key] as string);
  });
  validateUniqueStrings(values, path, issues);
}
function validateIdentifiers(values: string[], path: string, issues: BilValidationIssue[]): void { values.forEach((value, index) => { if (!idPattern.test(value)) issues.push(issue("semantic", `${path}[${index}]`, "A stable identifier is required.")); }); }
function validateUniqueStrings(values: string[], path: string, issues: BilValidationIssue[]): void { const seen = new Set<string>(); for (const value of values) { if (seen.has(value)) issues.push(issue("semantic", path, `Duplicate declaration: ${value}.`)); seen.add(value); } }
function validateStringArrayFields(value: unknown, path: string, fields: string[], issues: BilValidationIssue[]): void { if (!isRecord(value)) return; for (const field of fields) if (value[field] !== undefined && (!Array.isArray(value[field]) || (value[field] as unknown[]).some((item) => typeof item !== "string"))) issues.push(issue("structural", `${path}.${field}`, `${field} must be an array of strings.`)); }
function validateObjectArray(value: unknown, path: string, issues: BilValidationIssue[]): void { if (Array.isArray(value)) value.forEach((item, index) => { if (!isRecord(item)) issues.push(issue("structural", `${path}[${index}]`, "Entry must be an object.")); }); }
type ShapeType = "string" | "boolean" | "present" | "optionalString" | "optionalBoolean" | "optionalStringArray" | "stringArray";
function validateEntries(value: unknown, path: string, shape: Record<string, ShapeType>, issues: BilValidationIssue[]): void {
  if (!Array.isArray(value)) return;
  value.forEach((entry, index) => {
    if (!isRecord(entry)) return;
    for (const [key, expected] of Object.entries(shape)) {
      const field = entry[key]; const fieldPath = `${path}[${index}].${key}`;
      if (expected === "present" && !Object.hasOwn(entry, key)) issues.push(issue("structural", fieldPath, `${key} is required.`));
      if (expected === "string" && (typeof field !== "string" || !field)) issues.push(issue("structural", fieldPath, `${key} must be a non-empty string.`));
      if (expected === "boolean" && typeof field !== "boolean") issues.push(issue("structural", fieldPath, `${key} must be a boolean.`));
      if (expected === "optionalString" && field !== undefined && typeof field !== "string") issues.push(issue("structural", fieldPath, `${key} must be a string.`));
      if (expected === "optionalBoolean" && field !== undefined && typeof field !== "boolean") issues.push(issue("structural", fieldPath, `${key} must be a boolean.`));
      if (expected === "optionalStringArray" && field !== undefined && (!Array.isArray(field) || field.some((item) => typeof item !== "string"))) issues.push(issue("structural", fieldPath, `${key} must be an array of strings.`));
      if (expected === "stringArray" && (!Array.isArray(field) || field.some((item) => typeof item !== "string"))) issues.push(issue("structural", fieldPath, `${key} must be an array of strings.`));
    }
  });
}
function requiredString(value: Record<string, unknown>, key: string, issues: BilValidationIssue[]): void { if (typeof value[key] !== "string" || !(value[key] as string).trim()) issues.push(issue("structural", `$.${key}`, `${key} must be a non-empty string.`)); }
function requiredArray(value: Record<string, unknown>, key: string, issues: BilValidationIssue[]): void { if (!Array.isArray(value[key])) issues.push(issue("structural", `$.${key}`, `${key} must be an array.`)); }
function requiredRecord(value: Record<string, unknown>, key: string, issues: BilValidationIssue[]): void { if (!isRecord(value[key])) issues.push(issue("structural", `$.${key}`, `${key} must be an object.`)); }
function issue(level: "structural" | "semantic", path: string, message: string): BilValidationIssue { return { level, path, message }; }
function isPrimitive(value: unknown): value is string | number | boolean | null { return value === null || ["string", "number", "boolean"].includes(typeof value); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isJsonValue(value: unknown): boolean { return value === null || ["string", "number", "boolean"].includes(typeof value) || Array.isArray(value) && value.every(isJsonValue) || isRecord(value) && Object.values(value).every(isJsonValue); }
