import { Registry } from "../core/registry";
import { CapabilityProvider, ExecutorKind } from "./provider.types";

export class CapabilityProviderRegistry extends Registry<CapabilityProvider> {
  findByCapability(capabilityId: string): CapabilityProvider[] {
    return this.list().filter((provider) => provider.capabilityIds.includes(capabilityId));
  }

  findAvailableByCapability(capabilityId: string, executorKind?: ExecutorKind): CapabilityProvider[] {
    return this.findByCapability(capabilityId).filter(
      (provider) => provider.availability === "available" && (!executorKind || provider.executorKind === executorKind),
    );
  }
}
