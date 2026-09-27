import { CapabilityRegistry } from '../capabilities/capability.registry';
import { IntelligencePipeline } from '../intelligence/intelligence.pipeline';
import { IntelligenceProviderRegistry } from '../intelligence/intelligence-provider.registry';
import { MockIntelligenceProvider } from '../intelligence/mock-intelligence.provider';
import { adaptLegacyProvider } from '../providers/legacyCapabilityAdapter';
import { CapabilityProviderRegistry } from '../providers/provider.registry';
import { inspectPlanReadiness } from './plan-readiness';
import { runPlannedWebsiteScaffold } from './website-scaffold';
import { createBiktingOwnedTools } from './bikting-owned-tools';
import { isPersonalWebsiteRequest } from './intent-router';
// The existing JavaScript adapter catalogue has no TypeScript declaration yet.
// @ts-expect-error Existing JavaScript composition root.
import { createDefaultRegistries } from '../bikting/core/registry/createDefaultRegistries.js';

const capabilities = new CapabilityRegistry();
const executionProviders = new CapabilityProviderRegistry();
const seen = new Set<string>();
const owned = createBiktingOwnedTools();
for (const capability of owned.capabilities.list()) { capabilities.registerCapability(capability); seen.add(capability.id); }
for (const provider of owned.providers.list()) executionProviders.register(provider);
const legacy = createDefaultRegistries();
for (const adapter of [...legacy.tools.list(), ...legacy.models.list()]) {
  const adapted = adaptLegacyProvider(adapter);
  if (!executionProviders.has(adapted.provider.id)) executionProviders.register(adapted.provider);
  for (const capability of adapted.capabilities) {
    if (!seen.has(capability.id)) {
      capabilities.registerCapability(capability);
      seen.add(capability.id);
    }
  }
}

const providers = new IntelligenceProviderRegistry();
providers.register(new MockIntelligenceProvider({
  intentFixtures: [{
    match: (raw) => isPersonalWebsiteRequest(raw.text ?? ''),
    intentType: 'create', objective: 'Create a personal website', domain: 'software/web',
    target: 'personal website', concepts: ['website'],
    requestedOutputs: ['workspace', 'code', 'explanation'],
    possibleCapabilities: ['code.scaffold'],
  }],
  reasoningFixtures: [{
    match: (request) => request.intent?.intentType === 'create',
    conclusions: ['A personal website requires a project plan and project files.'],
    proposedTasks: [
      { purpose: 'Produce a three-file website starter', capabilityId: 'code.scaffold' },
    ],
    outputRequirements: [
      { type: 'workspace_files', required: true, capabilityId: 'code.scaffold' },
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
    providerId: 'mock.deterministic',
  });
  const missingKnowledge = [...new Set([
    ...result.intent.knowledgeNeeds.map(({ topic }) => topic),
    ...result.reasoningRun.knowledgeRequirements.map(({ topic }) => topic),
  ])];
  const plan = result.plan?.steps.length ? result.plan : null;
  return {
    mode: 'deterministic-preview',
    interpretation: result.intent,
    conclusions: result.reasoningRun.reasoning.conclusions,
    missingKnowledge,
    planningIssues: result.reasoningRun.issues.map(({ message }) => message),
    plan,
    stepReadiness: inspectPlanReadiness(plan, capabilities, executionProviders),
    installedTools: owned.installed,
    refusal: result.planningRefusal ?? (!plan ? missingKnowledge.length ? `Knowledge needed: ${missingKnowledge.join(', ')}. No source is configured yet.` : 'No executable plan was proposed.' : null),
    executed: false,
  };
}

export async function runWebsiteFromIntent(text: unknown, expectedPlanId: unknown) {
  if (typeof text !== 'string' || !isPersonalWebsiteRequest(text) || typeof expectedPlanId !== 'string') throw new TypeError('This local coding example supports the personal website request only.');
  const planned = await pipeline.run({ projectId: 'browser-preview', raw: { text: text.trim(), modality: 'text' }, capabilities, providerId: 'mock.deterministic' });
  if (!planned.plan || planned.plan.id !== expectedPlanId) throw new Error('The plan changed. Preview the request again before running it.');
  return runPlannedWebsiteScaffold(planned.plan);
}
