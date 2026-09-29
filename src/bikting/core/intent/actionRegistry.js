/** Action definitions describe reusable slots, relationship traversal and output steps. */
const builtins = [
  { id: 'teach', verbs: ['teach'], requiredSlots: ['topic'], question: 'What would you like me to teach?',
    introduction: 'learn', closing: 'check', capabilities: ['visual.scene', 'voice.synthesize'], maxRelationships: 12 },
  { id: 'explore', verbs: ['explore'], requiredSlots: ['topic'], question: 'What would you like to explore?',
    introduction: 'explore', closing: 'none', capabilities: ['visual.scene'], maxRelationships: 12 },
];

export class ActionRegistry {
  constructor(definitions = []) {
    this.definitions = new Map();
    this.verbs = new Map();
    for (const definition of definitions) this.register(definition);
  }

  register(definition) {
    if (!definition?.id || !Array.isArray(definition.verbs) || !definition.verbs.length ||
        !Array.isArray(definition.requiredSlots) || !Array.isArray(definition.capabilities) ||
        !Number.isInteger(definition.maxRelationships) || definition.maxRelationships < 1 || definition.maxRelationships > 24)
      throw new TypeError('An action needs an id, verbs, slots, capabilities and a bounded relationship limit.');
    if (this.definitions.has(definition.id) || definition.verbs.some((verb) => this.verbs.has(verb)))
      throw new Error(`Action or verb is already registered: ${definition.id}`);
    const copy = Object.freeze({ ...definition, verbs: Object.freeze([...definition.verbs]),
      requiredSlots: Object.freeze([...definition.requiredSlots]), capabilities: Object.freeze([...definition.capabilities]) });
    this.definitions.set(copy.id, copy);
    for (const verb of copy.verbs) this.verbs.set(verb, copy);
    return copy;
  }
  get(id) { return this.definitions.get(id) ?? null; }
  fromVerb(verb) { return this.verbs.get(verb) ?? null; }
}

export const defaultActionRegistry = new ActionRegistry(builtins);
export function getActionDefinition(id, registry = defaultActionRegistry) { return registry.get(id); }

/** Resolve an action word and the topic slot without consulting a model. */
export function resolveRelationalAction(text, registry = defaultActionRegistry) {
  const match = /\b([\p{L}]+)\b/gu;
  for (const word of String(text).matchAll(match)) {
    const definition = registry.fromVerb(word[1].toLowerCase());
    if (!definition) continue;
    const following = String(text).slice(word.index + word[0].length).replace(/^[\s,]*(?:(?:me|us|about|the)\s+)*/i, '').replace(/[?.!\s]+$/g, '').trim();
    return { definition, slots: { topic: following || null } };
  }
  return null;
}
