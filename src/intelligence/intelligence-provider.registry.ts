import { Registry } from "../core/registry";
import {
  ForbiddenIntelligenceDependency,
  IntelligenceCapabilities,
  IntelligenceProvider,
  IntelligenceSafetyProfile,
  IntelligenceTask,
} from "./intelligence-provider.types";

/**
 * Provider registry and task routing.
 *
 * Routing is by declared capability tags, never by provider name. Core Bikting contains no
 * `if (provider === "openai")` branch, so a provider can be replaced, added, or removed without
 * touching orchestration logic.
 */
export class IntelligenceProviderRegistry extends Registry<IntelligenceProvider> {
  /** All providers that declare support for a task, in deterministic id order. */
  forTask(task: IntelligenceTask): IntelligenceProvider[] {
    return this.list()
      .filter((provider) => provider.capabilities.tasks.includes(task))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  /** Deterministic selection: the first provider that declares the task. */
  resolve(task: IntelligenceTask): IntelligenceProvider {
    const candidate = this.forTask(task)[0];
    if (!candidate) throw new Error(`No intelligence provider is registered for task: ${task}`);
    return candidate;
  }

  /** Explicit selection with a deterministic fallback, used when a caller pins a provider id. */
  resolveWithFallback(task: IntelligenceTask, preferredProviderId?: string): IntelligenceProvider {
    if (preferredProviderId) {
      const preferred = this.get(preferredProviderId);
      if (!preferred) throw new Error(`Intelligence provider is not registered: ${preferredProviderId}`);
      if (!preferred.capabilities.tasks.includes(task)) {
        throw new Error(`Intelligence provider ${preferredProviderId} does not support task: ${task}`);
      }
      return preferred;
    }
    return this.resolve(task);
  }

  /**
   * The static security posture Bikting applies to every provider. It is a data contract, not a
   * runtime check, so a future adapter that tries to widen it fails its own conformance test.
   */
  safetyProfile(providerId: string): IntelligenceSafetyProfile {
    if (!this.has(providerId)) throw new Error(`Intelligence provider is not registered: ${providerId}`);
    return Object.freeze({
      providerId,
      receivesCredentials: false as const,
      receivesFilesystem: false as const,
      receivesShell: false as const,
      receivesNetwork: false as const,
      forbidden: Object.freeze([
        "capability_execution",
        "provider_invocation",
        "credential_selection",
        "filesystem_access",
        "shell_access",
        "network_access",
      ] as readonly ForbiddenIntelligenceDependency[]),
    });
  }
}

/** Enforces that a provider declares at least the tasks Bikting needs to route. */
export function assertProviderCapabilities(
  provider: IntelligenceProvider,
  requiredTasks: readonly IntelligenceTask[],
): void {
  const declared = new Set(provider.capabilities.tasks);
  const missing = requiredTasks.filter((task) => !declared.has(task));
  if (missing.length) {
    throw new Error(`Intelligence provider ${provider.id} is missing capabilities: ${missing.join(", ")}`);
  }
}

/** Freezes a capability declaration so routing decisions cannot be mutated after registration. */
export function freezeProviderCapabilities(capabilities: IntelligenceCapabilities): IntelligenceCapabilities {
  return Object.freeze({ ...capabilities, tasks: Object.freeze([...capabilities.tasks]) });
}
