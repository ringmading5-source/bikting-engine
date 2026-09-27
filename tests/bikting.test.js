import test from 'node:test';
import assert from 'node:assert/strict';
import { createSemanticObject, addEntity, addRelationship } from '../src/bikting/core/types/semantic.js';
import { RelationshipTypeRegistry } from '../src/bikting/core/relationships/RelationshipTypeRegistry.js';
import { ToolRegistry } from '../src/bikting/core/tools/ToolRegistry.js';
import { ModelRegistry } from '../src/bikting/core/models/ModelRegistry.js';
import { createDefaultRegistries } from '../src/bikting/core/registry/createDefaultRegistries.js';
import { BiktingOrchestrator } from '../src/bikting/core/orchestrator/BiktingOrchestrator.js';
import { mockSemanticInterpreter } from '../src/bikting/core/adapters/mockSemanticInterpreter.js';

test('creates a semantic object with required fields and defaults', () => {
  const semantic = createSemanticObject({ intent: 'explain', modality: 'text' });
  assert.equal(semantic.intent, 'explain');
  assert.equal(semantic.modality, 'text');
  for (const field of ['source', 'entities', 'concepts', 'relationships', 'actions', 'context', 'state', 'goals', 'constraints', 'requestedOutputs', 'provenance', 'confidence', 'timestamps']) assert.ok(field in semantic);
});

test('adds entities without duplicating ids', () => {
  const semantic = createSemanticObject();
  addEntity(semantic, 'current');
  addEntity(semantic, 'current');
  assert.equal(semantic.entities.length, 1);
  assert.equal(semantic.entities[0].id, 'current');
});

test('adds built-in and extensible relationships', () => {
  const semantic = createSemanticObject();
  const types = new RelationshipTypeRegistry();
  types.register('measures');
  addRelationship(semantic, { from: 'sensor', relation: 'measures', to: 'temperature' }, types);
  assert.equal(semantic.relationships[0].relation, 'measures');
  assert.throws(() => addRelationship(semantic, { from: 'x', relation: 'unknown_link', to: 'y' }, types), /Unknown relationship type/);
});

test('registers a tool', () => {
  const registry = new ToolRegistry();
  registry.register({ id: 'demo', name: 'Demo tool', domain: 'demo', capabilities: ['demo.run'], inputRequirements: [], outputTypes: ['demo_result'], metadata: {}, execute: async () => ({ ok: true }) });
  assert.equal(registry.list().length, 1);
});

test('rejects duplicate tool identifiers instead of replacing a registered tool', () => {
  const registry = new ToolRegistry();
  const tool = { id: 'demo', name: 'Demo tool', domain: 'demo', capabilities: ['demo.run'], execute: async () => ({ ok: true }) };
  registry.register(tool);
  assert.throws(() => registry.register(tool), /Tool registry already contains: demo/);
});

test('finds a registered tool by capability', () => {
  const registry = new ToolRegistry();
  registry.register({ id: 'demo', name: 'Demo tool', domain: 'demo', capabilities: ['demo.run'], inputRequirements: [], outputTypes: ['demo_result'], metadata: {}, execute: async () => ({ ok: true }) });
  assert.equal(registry.findByCapability('demo.run')[0].id, 'demo');
});

test('registers a model capability', () => {
  const registry = new ModelRegistry();
  registry.register({ id: 'model', name: 'Demo model', domain: 'language', modalities: ['text'], capabilities: ['text.generate'], execute: async () => 'ok' });
  assert.equal(registry.findByCapability('text.generate', { modality: 'text' })[0].id, 'model');
});

test('rejects duplicate model identifiers instead of replacing a registered model', () => {
  const registry = new ModelRegistry();
  const model = { id: 'model', name: 'Demo model', domain: 'language', modalities: ['text'], capabilities: ['text.generate'], execute: async () => 'ok' };
  registry.register(model);
  assert.throws(() => registry.register(model), /Model registry already contains: model/);
});

test('runs the motor request through interpretation, planning, routing, and adapters', async () => {
  const { tools, models } = createDefaultRegistries();
  const orchestrator = new BiktingOrchestrator({ interpret: mockSemanticInterpreter, tools, models });
  const result = await orchestrator.run({ text: 'Explain how an electric motor converts electrical energy into motion.' });
  assert.equal(result.semantic.intent, 'explain');
  assert.deepEqual(result.semantic.concepts, ['electric_motor']);
  assert.equal(result.semantic.relationships.length, 6);
  assert.ok(result.selectedCapabilities.includes('physics.represent'));
  assert.ok(result.selectedCapabilities.includes('math.calculate'));
  assert.ok(result.selectedCapabilities.includes('visual.scene'));
  assert.ok(result.selectedCapabilities.includes('text.generate'));
  assert.ok(result.selectedCapabilities.includes('voice.synthesize'));
});

test('returns a structured result with explanation, narration, visual plan, and explicit planned work', async () => {
  const { tools, models } = createDefaultRegistries();
  const orchestrator = new BiktingOrchestrator({ interpret: mockSemanticInterpreter, tools, models });
  const result = await orchestrator.run({ text: 'Explain how an electric motor converts electrical energy into motion.' });
  assert.equal(result.status, 'partial');
  assert.equal(result.outputs.explanation.type, 'explanation');
  assert.equal(result.outputs.narration.type, 'narration');
  assert.equal(result.outputs.visual.type, 'visual_scene');
  assert.ok(result.outputs.unexecuted.some((item) => item.metadata.capability === 'physics.represent'));
  assert.equal(result.plan.visualPolicy, 'deterministic_or_domain_renderer_by_default');
});
