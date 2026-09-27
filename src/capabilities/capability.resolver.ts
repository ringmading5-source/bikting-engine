import { CapabilityRegistry } from "./capability.registry";
import { Capability } from "./capability.types";

export interface CapabilityResolution {
  requiredOperation: string;
  capabilities: Capability[];
  unavailable: boolean;
}

export function resolveCapabilities(registry: CapabilityRegistry, operation: string): CapabilityResolution {
  const capabilities = registry.findByOperation(operation);
  return { requiredOperation: operation, capabilities, unavailable: capabilities.length === 0 };
}

export function resolveRelatedCapabilities(registry: CapabilityRegistry, capabilityId: string): Capability[] {
  const capability = registry.get(capabilityId);
  if (!capability) return [];
  return [...new Set([...(capability.requires ?? []), ...(capability.compatibleWith ?? [])])]
    .map((id) => registry.get(id))
    .filter((item): item is Capability => item !== undefined);
}
