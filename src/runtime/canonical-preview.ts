import { CapabilityRegistry } from '../capabilities/capability.registry';
import { IntelligencePipeline } from '../intelligence/intelligence.pipeline';
import { IntelligenceProviderRegistry } from '../intelligence/intelligence-provider.registry';
import { MockIntelligenceProvider } from '../intelligence/mock-intelligence.provider';
import { GeminiIntelligenceProvider } from '../intelligence/gemini-intelligence.provider';
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

const environment = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const geminiKey = environment.GEMINI_API_KEY;
if (geminiKey) providers.register(new GeminiIntelligenceProvider({ apiKey: geminiKey, model: environment.GEMINI_MODEL ?? 'gemini-2.5-flash' }));
const pipeline = new IntelligencePipeline(providers);

/** Local deterministic preview: planning only, with no capability execution. */
export async function previewIntent(text: string) {
  if (typeof text !== 'string' || !text.trim() || text.length > 4000) {
    throw new TypeError('Enter a request between 1 and 4000 characters.');
  }
  const result = await pipeline.run({
    projectId: 'browser-preview', raw: { text: text.trim(), modality: 'text' }, capabilities,
    providerId: geminiKey ? 'gemini.remote' : 'mock.deterministic',
  });
  const missingKnowledge = [...new Set([
    ...result.intent.knowledgeNeeds.map(({ topic }) => topic),
    ...result.reasoningRun.knowledgeRequirements.map(({ topic }) => topic),
  ])];
  const plan = result.plan?.steps.length ? result.plan : null;
  return {
    mode: geminiKey ? 'gemini-preview' : 'deterministic-preview',
    interpretation: result.intent,
    conclusions: result.reasoningRun.reasoning.conclusions,
    missingKnowledge,
    planningIssues: result.reasoningRun.issues.map(({ message }) => message),
    plan,
    refusal: result.planningRefusal ?? (!plan ? missingKnowledge.length ? `Knowledge needed: ${missingKnowledge.join(', ')}. No source is configured yet.` : 'No executable plan was proposed.' : null),
    executed: false,
  };
}
