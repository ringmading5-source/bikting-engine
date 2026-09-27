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
  executorKind: ExecutorKind;
  availability: ProviderAvailability;
  authorizationRequirements?: AuthorizationRequirement[];
  constraints?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}
