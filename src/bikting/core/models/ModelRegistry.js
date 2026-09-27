import { validateCapabilityAdapter } from '../tools/ToolRegistry.js';
import { normalizeCapability, capabilityMatches } from '../types/capability.js';

export class ModelRegistry {
  #models = new Map();
  register(model) {
    validateCapabilityAdapter(model, 'model');
    if (this.#models.has(model.id)) throw new Error(`Model registry already contains: ${model.id}`);
    const registered = { modalities: [], metadata: {}, ...model };
    registered.capabilityDefinitions = model.capabilities.map((capability) => normalizeCapability(capability, registered));
    registered.capabilities = registered.capabilityDefinitions.map(({ id }) => id);
    this.#models.set(model.id, registered);
    return this.#models.get(model.id);
  }
  get(id) { return this.#models.get(id); }
  findByCapability(capability, { modality, domain } = {}) {
    return [...this.#models.values()].filter((model) => model.capabilityDefinitions.some((definition) => capabilityMatches(definition, capability) && (!domain || definition.domain === domain)) && (!modality || model.modalities.includes(modality)));
  }
  resolveCapability(capability, options) {
    const models = this.findByCapability(capability, options);
    return models.length ? { status: 'available', requiredCapability: capability, models } : { status: 'unavailable', requiredCapability: typeof capability === 'string' ? capability : capability.id, reason: 'No registered capability can perform this operation.' };
  }
  capabilityCatalog() { return this.list().flatMap((model) => model.capabilityDefinitions); }
  list() { return [...this.#models.values()]; }
}
