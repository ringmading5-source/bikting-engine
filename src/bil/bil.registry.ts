import { Registry } from "../core/registry";
import { BilModule, BilModuleKind } from "./bil.types";
import { assertValidBilModule } from "./bil.validator";

export class BilRegistry extends Registry<BilModule> {
  override register(module: BilModule): BilModule {
    return super.register(assertValidBilModule(module));
  }

  listByKind(kind: BilModuleKind): BilModule[] {
    return this.list().filter((module) => module.kind === kind);
  }
}
