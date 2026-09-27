import { motorModule } from './science/motorModule.js';
import { genericModule } from './general/genericModule.js';

export class ModuleRegistry {
  #modules = new Map();
  register(module) {
    if (!module.id || typeof module.canHandle !== 'function' || typeof module.execute !== 'function') throw new TypeError('A module needs an id, canHandle(), and execute().');
    if (this.#modules.has(module.id)) throw new Error(`Module registry already contains: ${module.id}`);
    this.#modules.set(module.id, module);
  }
  select(interpretation) {
    return [...this.#modules.values()].find((module) => module.canHandle(interpretation)) ?? null;
  }
  list() { return [...this.#modules.keys()]; }
}

export const moduleRegistry = new ModuleRegistry();
moduleRegistry.register(motorModule);
moduleRegistry.register(genericModule);
