import { UserIntent } from "../intent/intent.types";

export type SemanticConceptKind = "concept" | "entity" | "event" | "process" | "quantity_property" | "constraint";
export interface SemanticConcept { id: string; kind: SemanticConceptKind; source: "intent_object" | "intent_action" | "structured_context"; rawValue?: string; provenance: { intentPath: string }; }
export interface SemanticConceptSet { id: string; concepts: SemanticConcept[]; extractorId: string; }
export interface ConceptExtractor { readonly id: string; extract(intent: UserIntent): SemanticConceptSet; }

/** Extracts only canonical structured fields; it never tokenizes every word in rawInput. */
export class StructuredIntentConceptExtractor implements ConceptExtractor {
  readonly id = "structured-intent-concepts";
  extract(intent: UserIntent): SemanticConceptSet {
    const concepts: SemanticConcept[] = [];
    for (const [index, id] of (intent.objects ?? []).entries()) concepts.push(item(id, "concept", "intent_object", `objects.${index}`));
    const declared = intent.context?.semanticConcepts;
    if (Array.isArray(declared)) for (const [index, value] of declared.entries()) { if (typeof value === "string") concepts.push(item(value, "concept", "structured_context", `context.semanticConcepts.${index}`)); else if (isRecord(value) && typeof value.id === "string" && isKind(value.kind)) concepts.push(item(value.id, value.kind, "structured_context", `context.semanticConcepts.${index}`)); }
    for (const [index, action] of (intent.actions ?? []).entries()) if (["change", "increase", "decrease", "cause", "explain"].includes(action)) concepts.push(item(action === "explain" || action === "cause" ? "causal_effect" : action, "event", "intent_action", `actions.${index}`));
    const unique = [...new Map(concepts.map((concept) => [`${concept.id}:${concept.kind}`, concept])).values()].sort((a, b) => a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind));
    return deepFreeze({ id: `semantic-concepts-${hash(stableStringify(unique))}`, concepts: unique, extractorId: this.id });
  }
}
function item(id: string, kind: SemanticConceptKind, source: SemanticConcept["source"], intentPath: string): SemanticConcept { return { id, kind, source, rawValue: id, provenance: { intentPath } }; }
function isKind(value: unknown): value is SemanticConceptKind { return typeof value === "string" && ["concept", "entity", "event", "process", "quantity_property", "constraint"].includes(value); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function stableStringify(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`; return JSON.stringify(value); }
function hash(value: string): string { let result = 2166136261; for (let i = 0; i < value.length; i++) { result ^= value.charCodeAt(i); result = Math.imul(result, 16777619); } return (result >>> 0).toString(16).padStart(8, "0"); }
function deepFreeze<T>(value: T): T { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item); return Object.freeze(value); }
