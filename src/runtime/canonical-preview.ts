import { CapabilityRegistry } from '../capabilities/capability.registry';
import { IntelligencePipeline } from '../intelligence/intelligence.pipeline';
import { IntelligenceProviderRegistry } from '../intelligence/intelligence-provider.registry';
import { MockIntelligenceProvider } from '../intelligence/mock-intelligence.provider';
import { adaptLegacyProvider } from '../providers/legacyCapabilityAdapter';
// The existing JavaScript adapter catalogue has no TypeScript declaration yet.
// @ts-expect-error Existing JavaScript composition root.
import { createDefaultRegistries } from '../bikting/core/registry/createDefaultRegistries.js';

const capabilities = new CapabilityRegistry();
const seen = new Set<string>();
const legacy = createDefaultRegistries();
for (const adapter of [...legacy.tools.list(), ...legacy.models.list()]) {
  for (const capability of adaptLegacyProvider(adapter).capabilities) {
    if (!seen.has(capability.id)) {
      capabilities.registerCapability(capability);
      seen.add(capability.id);
    }
  }
}

const providers = new IntelligenceProviderRegistry();
providers.register(new MockIntelligenceProvider({
  intentFixtures: [{
    match: (raw) => /^build for me my personal website[.!?]?$/i.test(raw.text?.trim() ?? ''),
    intentType: 'create', objective: 'Create a personal website', domain: 'software/web',
    target: 'personal website', concepts: ['website'],
    requestedOutputs: ['workspace', 'code', 'explanation'],
    possibleCapabilities: ['code.execute', 'text.generate'],
  }],
  reasoningFixtures: [{
    match: (request) => request.intent?.intentType === 'create',
    conclusions: ['A personal website requires a project plan and project files.'],
    proposedTasks: [
      { purpose: 'Plan the site structure', capabilityId: 'text.generate' },
      { purpose: 'Produce the project files', capabilityId: 'code.execute' },
    ],
    outputRequirements: [
      { type: 'workspace', required: true, capabilityId: 'code.execute' },
      { type: 'explanation', required: true, capabilityId: 'text.generate' },
    ],
  }],
}));

const pipeline = new IntelligencePipeline(providers);

/** Local deterministic preview: planning only, with no capability execution. */
export async function previewIntent(text: string) {
  if (typeof text !== 'string' || !text.trim() || text.length > 4000) {
    throw new TypeError('Enter a request between 1 and 4000 characters.');
  }
  const result = await pipeline.run({
    projectId: 'browser-preview', raw: { text: text.trim(), modality: 'text' }, capabilities,
  });
  return {
    mode: 'deterministic-preview',
    interpretation: result.intent,
    conclusions: result.reasoningRun.reasoning.conclusions,
    plan: result.plan ?? null,
    refusal: result.planningRefusal ?? null,
    executed: false,
  };
}
