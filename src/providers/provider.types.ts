import { AuthorizationRequirement } from "../core/access";

export type ExecutorKind =
  | "api"
  | "agent"
  | "browser"
  | "terminal"
  | "local_runtime"
  | "llm"
  | "plugin"
  | "deterministic"
  | "custom";

export type ProviderAvailability = "available" | "unavailable" | "degraded" | "unknown";

/** A concrete implementation of capabilities. This is intentionally not a Capability. */
export interface CapabilityProvider {
  id: string;
  name: string;
  description?: string;
  capabilityIds: string[];
  /** Observable contract for this implementation, independent of its display name. */
  properties?: { operations: string[]; inputs: Array<{ name: string; type: string }>; outputs: Array<{ name: string; type: string }> };
  executorKind: ExecutorKind;
  availability: ProviderAvailability;
  authorizationRequirements?: AuthorizationRequirement[];
  constraints?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}
