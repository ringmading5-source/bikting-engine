import { Capability } from "../capabilities/capability.types";
import { CapabilityProvider, ExecutorKind, ProviderAvailability } from "./provider.types";

export interface LegacyCapabilityDefinition {
  id: string;
  domain?: string;
  operation?: string;
  aliases?: string[];
  acceptedInputs?: string[];
  producedOutputs?: string[];
  executionMode?: string;
  executionRequirements?: string[];
  visual?: boolean;
  computational?: boolean;
  explanatory?: boolean;
  metadata?: Record<string, unknown>;
}

export interface LegacyProviderDefinition {
  id: string;
  name: string;
  domain?: string;
  capabilities?: string[];
  capabilityDefinitions?: LegacyCapabilityDefinition[];
  deterministic?: boolean;
  executionMode?: string;
  metadata?: Record<string, unknown>;
}

export interface LegacyProviderAdaptation {
  capabilities: Capability[];
  provider: CapabilityProvider;
}

/** Creates canonical snapshots without mutating or wrapping the active JavaScript adapter. */
export function adaptLegacyProvider(definition: LegacyProviderDefinition, kind?: ExecutorKind): LegacyProviderAdaptation {
  const legacyCapabilities = definition.capabilityDefinitions ?? (definition.capabilities ?? []).map((id) => ({ id }));
  const capabilities = uniqueById(legacyCapabilities.map(toCapability));
  const availability: ProviderAvailability = definition.metadata?.ready === false ? "unavailable" : "available";
  const provider: CapabilityProvider = {
    id: definition.id,
    name: definition.name,
    description: typeof definition.metadata?.description === "string" ? definition.metadata.description : undefined,
    capabilityIds: capabilities.map(({ id }) => id),
    executorKind: kind ?? inferExecutorKind(definition),
    availability,
    constraints: definition.domain ? { domain: definition.domain } : undefined,
    metadata: { legacy: true, ...(definition.metadata ?? {}) },
  };
  return { capabilities, provider };
}

function toCapability(definition: LegacyCapabilityDefinition): Capability {
  const operation = definition.operation ?? definition.id.split(".").at(-1) ?? definition.id;
  return {
    id: definition.id,
    kind: "capability",
    name: humanize(definition.id),
    description: `Canonical representation of legacy capability ${definition.id}.`,
    inputs: (definition.acceptedInputs ?? []).map((name) => ({ name, type: "unknown" })),
    outputs: (definition.producedOutputs ?? []).map((name) => ({ name, type: name })),
    environmentRequirements: [...(definition.executionRequirements ?? [])],
    operations: [...new Set([operation, ...(definition.aliases ?? [])])],
    metadata: {
      legacy: true,
      domain: definition.domain,
      executionMode: definition.executionMode,
      visual: definition.visual ?? false,
      computational: definition.computational ?? false,
      explanatory: definition.explanatory ?? false,
      ...(definition.metadata ?? {}),
    },
  };
}

function inferExecutorKind(definition: LegacyProviderDefinition): ExecutorKind {
  if (definition.deterministic || definition.executionMode === "deterministic") return "deterministic";
  if (definition.executionMode === "generative" || definition.domain === "language" || definition.domain === "voice" || definition.domain === "vision") return "llm";
  return "custom";
}

function uniqueById(capabilities: Capability[]): Capability[] {
  return [...new Map(capabilities.map((capability) => [capability.id, capability])).values()];
}

function humanize(value: string): string {
  return value.replaceAll(".", " ").replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
