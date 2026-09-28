export interface IntentRoute {
  id: string;
  intent: 'calculate' | 'learn' | 'create';
  capabilityId: string;
  inputs: Record<string, string>;
  needsExplicitRun: boolean;
}
export interface IntentRule { id: string; resolve(text: string): IntentRoute | null }

/** Pluggable deterministic boundary. Unknown wording stays unknown instead of being guessed. */
export class IntentRuleRegistry {
  private readonly rules: IntentRule[] = [];
  register(rule: IntentRule): void {
    if (this.rules.some(({ id }) => id === rule.id)) throw new Error(`Intent rule already registered: ${rule.id}`);
    this.rules.push(rule);
  }
  resolve(text: unknown): IntentRoute | null {
    if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw new TypeError('Enter a request between 1 and 4000 characters.');
    for (const rule of this.rules) {
      const result = rule.resolve(text.trim());
      if (result) return result;
    }
    return null;
  }
}

export function isPersonalWebsiteRequest(text: string): boolean {
  return /^(?:build|create|make)(?: for me)? my personal website[.!?]?$/i.test(text.trim());
}

export function createDefaultIntentRules(): IntentRuleRegistry {
  const registry = new IntentRuleRegistry();
  registry.register({ id: 'arithmetic', resolve(text) {
    const expression = /^(?:calculate|compute|evaluate)\s+([\d\s.+\-*/%^()×÷eE]+)\s*$/i.exec(text)?.[1]?.trim();
    return expression ? { id: 'arithmetic', intent: 'calculate', capabilityId: 'math.calculate', inputs: { expression }, needsExplicitRun: true } : null;
  } });
  registry.register({ id: 'personal-website', resolve(text) {
    return isPersonalWebsiteRequest(text) ? { id: 'personal-website', intent: 'create', capabilityId: 'code.scaffold', inputs: {}, needsExplicitRun: true } : null;
  } });
  registry.register({ id: 'public-knowledge', resolve(text) {
    const topic = /^(?:teach me|explain|learn about|what is)\s+(.+?)\s*[.!?]?\s*$/i.exec(text)?.[1]?.trim();
    if (topic && (/\b(?:plus|minus|times|divided by)\b/i.test(topic) || /\d\s*[+*/×÷]\s*\d/.test(topic))) return null;
    return topic ? { id: 'public-knowledge', intent: 'learn', capabilityId: 'knowledge.public_search', inputs: { topic }, needsExplicitRun: false } : null;
  } });
  return registry;
}
