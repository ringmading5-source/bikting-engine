export interface CanonicalProviderInvocation { runId: string; planId: string; stepId: string; capabilityId: string; providerId: string; input: Readonly<Record<string, unknown>>; }
export interface ExecutableProviderAdapter { providerId: string; capabilityIds: string[]; invoke(request: CanonicalProviderInvocation): Promise<unknown>; }

/** Explicit execution allowlist. CapabilityProvider metadata is never executable. */
export class CanonicalProviderInvoker {
  private readonly adapters = new Map<string, ExecutableProviderAdapter>();
  register(adapter: ExecutableProviderAdapter): void { if (this.adapters.has(adapter.providerId)) throw new Error(`Execution adapter already registered: ${adapter.providerId}`); this.adapters.set(adapter.providerId, adapter); }
  has(providerId: string, capabilityId: string): boolean { return this.adapters.get(providerId)?.capabilityIds.includes(capabilityId) ?? false; }
  async invoke(request: CanonicalProviderInvocation): Promise<unknown> {
    const adapter = this.adapters.get(request.providerId);
    if (!adapter || !adapter.capabilityIds.includes(request.capabilityId)) throw new Error(`Provider ${request.providerId} is not enabled to execute ${request.capabilityId}.`);
    return adapter.invoke({ ...request, input: deepFreeze(structuredClone(request.input)) });
  }
}
function deepFreeze<T>(value: T): T { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item); return Object.freeze(value); }
