import test from 'node:test';
import assert from 'node:assert/strict';
import { createSemanticObject } from '../src/bikting/core/types/semantic.js';
import { planIntent } from '../src/bikting/core/planner/planIntent.js';
import { ToolRegistry } from '../src/bikting/core/tools/ToolRegistry.js';
import { createDefaultRegistries } from '../src/bikting/core/registry/createDefaultRegistries.js';
import { BiktingOrchestrator } from '../src/bikting/core/orchestrator/BiktingOrchestrator.js';
import { mockSemanticInterpreter } from '../src/bikting/core/adapters/mockSemanticInterpreter.js';

const cases = [
  ['Calculate 25 × 48.', ['math.calculate']],
  ['Plot y = x².', ['math.calculate', 'visual.scene']],
  ['Explain how an electric motor works.', ['physics.represent', 'visual.scene', 'text.generate', 'voice.synthesize']],
  ['Show the relationship between force, mass and acceleration.', ['physics.represent', 'math.calculate', 'visual.scene', 'text.generate']],
  ['Analyze this image.', ['vision.interpret']],
  ['Write a Python function that calculates compound interest.', ['code.execute', 'text.generate']],
  ['What caused this trend in my dataset?', ['statistics.analyze', 'text.generate']],
];

test('registered capabilities provide the full planning contract', () => {
  const { catalog } = createDefaultRegistries();
  for (const capability of catalog) {
    for (const field of ['id', 'domain', 'operation', 'acceptedInputs', 'producedOutputs', 'executionMode', 'visual', 'computational', 'explanatory', 'executionRequirements']) assert.ok(field in capability, `${capability.id} missing ${field}`);
  }
});

test('capability matching supports operations and explicit unavailable results', () => {
  const { tools } = createDefaultRegistries();
  assert.equal(tools.resolveCapability('calculate').tools[0].id, 'math.calculator');
  assert.equal(tools.resolveCapability('simulate_physics').tools[0].id, 'physics.placeholder');
  assert.equal(tools.resolveCapability('render_structured_scene').tools[0].id, 'visualization.structured-scene');
  assert.deepEqual(tools.resolveCapability('does_not_exist'), { status: 'unavailable', requiredCapability: 'does_not_exist', reason: 'No registered capability can perform this operation.' });
});

test('deterministic tools take precedence over a generative provider for the same operation', () => {
  const { tools, models, catalog } = createDefaultRegistries();
  models.register({ id: 'mock.math-text', name: 'Math language model', domain: 'language', modalities: ['text'], capabilities: [{ id: 'math.calculate', executionMode: 'generative' }], execute: async () => ({ text: 'approximate' }) });
  const semantic = createSemanticObject({ intent: 'calculate', context: { domain: 'mathematics' }, requestedOutputs: ['numeric_result'] });
  const capability = planIntent(semantic, { tools, models, catalog: [...catalog, ...models.capabilityCatalog().slice(-1)] }).requiredCapabilities[0];
  assert.deepEqual(capability.providers.map(({ id }) => id), ['math.calculator']);
});

test('planner selects capabilities from semantic fields for all seven request intents', async () => {
  const { tools, models, catalog } = createDefaultRegistries();
  for (const [text, expected] of cases) {
    const semantic = createSemanticObject(await mockSemanticInterpreter({ text }));
    const plan = planIntent(semantic, { tools, models, catalog });
    for (const capability of expected) assert.ok(plan.capabilities.includes(capability), `${text} did not plan ${capability}`);
  }
});

test('planner ignores raw request wording and relies on structured semantics', () => {
  const { tools, models, catalog } = createDefaultRegistries();
  const semantic = createSemanticObject({ intent: 'plot', concepts: ['quadratic_function'], context: { domain: 'mathematics', requestText: 'unrelated words' }, requestedOutputs: ['graph'] });
  const first = planIntent(semantic, { tools, models, catalog });
  semantic.context.requestText = 'different arbitrary text';
  const second = planIntent(semantic, { tools, models, catalog });
  assert.deepEqual(first.capabilities, second.capabilities);
  assert.deepEqual(first.capabilities, ['math.calculate', 'visual.scene']);
});

test('orchestrator returns unavailable instead of substituting an unrelated model', async () => {
  const { models } = createDefaultRegistries();
  const tools = new ToolRegistry();
  const orchestrator = new BiktingOrchestrator({ interpret: async () => ({ intent: 'calculate', concepts: [], context: { domain: 'mathematics' }, requestedOutputs: ['numeric_result'] }), tools, models });
  const result = await orchestrator.run({ text: 'structured test input' });
  assert.equal(result.status, 'partial');
  assert.equal(result.execution[0].status, 'unavailable');
  assert.equal(result.execution[0].requiredCapability, 'math.calculate');
  assert.equal(result.outputs.explanation, null);
});

test('orchestration trace exposes each development stage', async () => {
  const { tools, models } = createDefaultRegistries();
  const result = await new BiktingOrchestrator({ interpret: mockSemanticInterpreter, tools, models }).run({ text: 'Explain how an electric motor works.' });
  for (const section of ['[INPUT]', '[SEMANTIC]', '[INTENT]', '[CONCEPTS]', '[RELATIONSHIPS]', '[REQUIRED CAPABILITIES]', '[SELECTED TOOLS]', '[EXECUTION]', '[OUTPUTS]']) assert.ok(result.traceText.includes(section), `${section} is missing`);
  assert.ok(result.traceText.includes('physics.placeholder'));
});

test('execution results keep semantic and relationship provenance', async () => {
  const { tools, models } = createDefaultRegistries();
  const result = await new BiktingOrchestrator({ interpret: mockSemanticInterpreter, tools, models }).run({ text: 'Explain how an electric motor works.' });
  const output = result.execution.find((item) => item.metadata.capability === 'text.generate');
  assert.equal(output.semanticId, result.semantic.id);
  assert.equal(output.type, 'explanation');
  assert.ok(Array.isArray(output.provenance));
  assert.ok(Array.isArray(output.relationships));
});
