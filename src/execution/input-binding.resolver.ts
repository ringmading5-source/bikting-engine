import { PlanStep } from "../planning/plan.types";

export interface BindingResolutionContext { intent?: Record<string, unknown>; context?: Record<string, unknown>; stepOutputs: ReadonlyMap<string, unknown>; }
export interface BindingResolutionFailure { bindingTarget: string; code: "unsafe_path" | "missing_value" | "missing_step_output"; message: string; }
export type BindingResolutionResult = { status: "resolved"; inputs: Readonly<Record<string, unknown>> } | { status: "unresolved"; failures: BindingResolutionFailure[] };
const dangerous = new Set(["__proto__", "prototype", "constructor"]);

/** Resolves declarative data paths only. It never evaluates expressions or invokes properties. */
export function resolveStepInputBindings(step: PlanStep, source: BindingResolutionContext): BindingResolutionResult {
  const inputs: Record<string, unknown> = structuredClone(step.inputs ?? {}); const failures: BindingResolutionFailure[] = [];
  for (const binding of step.inputBindings ?? []) {
    let root: unknown; let path: string[] = [];
    if (binding.source.type === "literal") root = binding.source.value;
    else if (binding.source.type === "intent") { root = source.intent; path = binding.source.path; }
    else if (binding.source.type === "context") { root = source.context; path = binding.source.path; }
    else { if (!source.stepOutputs.has(binding.source.stepId)) { failures.push({ bindingTarget: binding.target, code: "missing_step_output", message: `No completed output exists for ${binding.source.stepId}.` }); continue; } root = source.stepOutputs.get(binding.source.stepId); path = binding.source.path; }
    const resolved = safeRead(root, path);
    if (resolved.code) failures.push({ bindingTarget: binding.target, code: resolved.code, message: resolved.message! }); else inputs[binding.target] = structuredClone(resolved.value);
  }
  return failures.length ? { status: "unresolved", failures } : { status: "resolved", inputs: deepFreeze(inputs) };
}

function safeRead(root: unknown, path: string[]): { value?: unknown; code?: "unsafe_path" | "missing_value"; message?: string } {
  let value = root;
  for (const segment of path) {
    if (dangerous.has(segment)) return { code: "unsafe_path", message: `Unsafe binding path segment: ${segment}.` };
    if (value === null || typeof value !== "object" || typeof value === "function" || !Object.prototype.hasOwnProperty.call(value, segment)) return { code: "missing_value", message: `Binding path does not exist: ${path.join(".")}.` };
    const descriptor = Object.getOwnPropertyDescriptor(value, segment);
    if (!descriptor || descriptor.get || descriptor.set) return { code: "unsafe_path", message: `Binding path is not a plain data property: ${segment}.` };
    value = descriptor.value;
  }
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return { code: "missing_value", message: `Binding path has no data value: ${path.join(".")}.` };
  return { value };
}
function deepFreeze<T>(value: T): T { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item); return Object.freeze(value); }
