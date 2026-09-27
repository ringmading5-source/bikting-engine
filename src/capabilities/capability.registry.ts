import { BiktingGraph } from "../core/graph";
import { Registry } from "../core/registry";
import { Capability } from "./capability.types";

export class CapabilityRegistry extends Registry<Capability> {
  registerCapability(capability: Capability, graph?: BiktingGraph): Capability {
    const registered = this.register(capability);
    graph?.addEntity(capability);
    return registered;
  }

  findByOperation(operation: string): Capability[] {
    return this.list().filter((capability) => capability.operations.includes(operation));
  }

  findByOutput(output: string): Capability[] {
    return this.list().filter((capability) => capability.outputs.some((item) => item.type === output || item.name === output));
  }
}
