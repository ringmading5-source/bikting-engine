import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiIntelligenceProvider } from '../src/intelligence/gemini-intelligence.provider';
import { IntelligencePipeline } from '../src/intelligence/intelligence.pipeline';
import { IntelligenceProviderRegistry } from '../src/intelligence/intelligence-provider.registry';
import { CapabilityRegistry } from '../src/capabilities/capability.registry';

function fakeResponse(data: unknown): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] } }] }), { status: 200 });
}

test('real provider boundary plans a varied creation request through Bikting validation', async () => {
  const calls: string[] = [];
  const replies = [
    { objective: 'Create a portfolio for a photographer', intentType: 'create', concepts: ['portfolio'], relationships: [], requestedOutputs: ['workspace'], possibleCapabilities: ['code.execute'], knowledgeNeeds: [] },
    { conclusions: ['A portfolio needs project files.'], proposedTasks: [{ purpose: 'Create files', capabilityId: 'code.execute' }], additionalKnowledgeNeeds: [], outputRequirements: [{ type: 'workspace', required: true, capabilityId: 'code.execute' }] },
  ];
  const provider = new GeminiIntelligenceProvider({ apiKey: 'test-secret', model: 'gemini-test', fetcher: async (_url, init) => {
    assert.equal((init?.headers as Record<string, string>)['x-goog-api-key'], 'test-secret');
    calls.push(JSON.parse(init?.body as string).contents[0].parts[0].text);
    return fakeResponse(replies.shift());
  } });
  const registry = new IntelligenceProviderRegistry(); registry.register(provider);
  const capabilities = new CapabilityRegistry();
  capabilities.registerCapability({ id: 'code.execute', kind: 'capability', name: 'Code', operations: ['create'], inputs: [], outputs: [{ name: 'workspace', type: 'workspace' }] });
  const result = await new IntelligencePipeline(registry).run({ projectId: 'preview', raw: { text: 'Make my photography portfolio', modality: 'text' }, capabilities });
  assert.equal(result.intent.objective, 'Create a portfolio for a photographer');
  assert.equal(result.plan?.steps[0].capabilityId, 'code.execute');
  assert.equal(calls.length, 2);
  assert.ok(!JSON.stringify(result).includes('test-secret'));
});

test('teaching without a knowledge source reports a gap and does not propose teaching tasks', async () => {
  const replies = [
    { objective: 'Understand cells', intentType: 'learn', domain: 'biology', concepts: ['cell'], relationships: [], requestedOutputs: ['explanation'], possibleCapabilities: ['text.generate'], knowledgeNeeds: [{ topic: 'cell', required: true }] },
    { conclusions: ['Cells are interesting.'], proposedTasks: [{ purpose: 'Explain cells', capabilityId: 'text.generate' }], additionalKnowledgeNeeds: [], outputRequirements: [] },
  ];
  const registry = new IntelligenceProviderRegistry();
  registry.register(new GeminiIntelligenceProvider({ apiKey: 'test-secret', model: 'gemini-test', fetcher: async () => fakeResponse(replies.shift()) }));
  const capabilities = new CapabilityRegistry();
  capabilities.registerCapability({ id: 'text.generate', kind: 'capability', name: 'Text', operations: ['explain'], inputs: [], outputs: [{ name: 'explanation', type: 'text' }] });
  const result = await new IntelligencePipeline(registry).run({ projectId: 'preview', raw: { text: 'Teach me cells', modality: 'text' }, capabilities });
  assert.equal(result.reasoningRun.reasoning.proposedTasks.length, 0);
  assert.equal(result.intent.knowledgeNeeds[0].topic, 'cell');
  assert.equal(result.plan?.steps.length, 0);
});
