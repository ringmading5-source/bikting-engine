import { normalizeCapability, capabilityMatches } from '../types/capability.js';

export class ToolRegistry {
  #tools = new Map();
  register(tool) {
    validateCapabilityAdapter(tool, 'tool');
    if (this.#tools.has(tool.id)) throw new Error(`Tool registry already contains: ${tool.id}`);
    const registered = { inputRequirements: [], outputTypes: [], metadata: {}, ...tool };
    const declarations = tool.capabilities ?? tool.operations.map((operation) => typeof operation === 'string' ? { id: `${tool.domain}.${operation}`, operation } : operation);
    registered.capabilityDefinitions = declarations.map((capability) => normalizeCapability(capability, registered));
    registered.capabilities = registered.capabilityDefinitions.map(({ id }) => id);
    registered.operations = tool.operations ?? registered.capabilityDefinitions.map(({ operation }) => operation);
    registered.inputSchema ??= { type: 'object', required: registered.inputRequirements };
    registered.outputSchema ??= { type: 'object', properties: Object.fromEntries(registered.outputTypes.map((type) => [type, {}])) };
    registered.deterministic ??= registered.capabilityDefinitions.every(({ executionMode }) => executionMode === 'deterministic');
    registered.executionMode ??= registered.deterministic ? 'deterministic' : 'generative';
    this.#tools.set(tool.id, registered);
    return this.#tools.get(tool.id);
  }
  get(id) { return this.#tools.get(id); }
  findByCapability(capability, { domain, deterministicFirst = true } = {}) {
    const matches = [...this.#tools.values()].filter((tool) => tool.capabilityDefinitions.some((definition) => capabilityMatches(definition, capability) && (!domain || definition.domain === domain)));
    if (deterministicFirst) matches.sort((a, b) => Number(!isDeterministic(a, capability)) - Number(!isDeterministic(b, capability)));
    return matches;
  }
  resolveCapability(capability, options) {
    const tools = this.findByCapability(capability, options);
    return tools.length ? { status: 'available', requiredCapability: capability, tools } : { status: 'unavailable', requiredCapability: typeof capability === 'string' ? capability : capability.id, reason: 'No registered capability can perform this operation.' };
  }
  capabilityCatalog() { return this.list().flatMap((tool) => tool.capabilityDefinitions); }
  list() { return [...this.#tools.values()]; }
}

function isDeterministic(tool, query) { return tool.capabilityDefinitions.some((definition) => capabilityMatches(definition, query) && definition.executionMode === 'deterministic'); }

export function validateCapabilityAdapter(adapter, kind) {
  if (!adapter?.id || !adapter.name || !adapter.domain || (!Array.isArray(adapter.capabilities) && !Array.isArray(adapter.operations)) || typeof adapter.execute !== 'function') {
    throw new TypeError(`A ${kind} needs id, name, domain, capabilities or operations, and execute().`);
  }
}
