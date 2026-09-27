import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExpression } from '../src/bikting/core/execution/SafeExpression.js';
import { createDefaultRegistries } from '../src/bikting/core/registry/createDefaultRegistries.js';
import { BiktingOrchestrator } from '../src/bikting/core/orchestrator/BiktingOrchestrator.js';
import { mockSemanticInterpreter } from '../src/bikting/core/adapters/mockSemanticInterpreter.js';
import { statisticsTool } from '../src/bikting/core/tools/deterministic/statisticsTool.js';
import { equationEvaluatorTool } from '../src/bikting/core/tools/deterministic/mathTools.js';
import { unitConversionTool } from '../src/bikting/core/tools/deterministic/unitConversionTool.js';

async function run(text) {
  const registries = createDefaultRegistries();
  const orchestrator = new BiktingOrchestrator({ interpret: mockSemanticInterpreter, ...registries });
  return orchestrator.run({ text });
}

test('safe expression evaluator handles arithmetic and rejects executable JavaScript', () => {
  assert.equal(evaluateExpression('(1250 / 5) + 37'), 287);
  assert.equal(evaluateExpression('x^2', { x: 4 }), 16);
  assert.throws(() => evaluateExpression('globalThis.process.exit()'), /Unsupported expression token/);
});

test('equation evaluator and calculator support structured expressions', async () => {
  assert.equal((await equationEvaluatorTool.execute({ equation: 'result = 2 * y', variables: { y: 4 } })).numericResult, 8);
  assert.equal((await run('Calculate (1250 / 5) + 37.')).execution.find((item) => item.numericResult !== undefined).numericResult, 287);
});

test('statistics tool supports median, extrema, variance, and correlation', async () => {
  const input = { data: [2, 4, 6, 8] };
  assert.equal((await statisticsTool.execute({ ...input, statistic: 'median' })).numericResult, 5);
  assert.equal((await statisticsTool.execute({ ...input, statistic: 'min' })).numericResult, 2);
  assert.equal((await statisticsTool.execute({ ...input, statistic: 'max' })).numericResult, 8);
  assert.equal((await statisticsTool.execute({ ...input, statistic: 'variance' })).numericResult, 5);
  assert.equal((await statisticsTool.execute({ data: [1, 2, 3], otherData: [2, 4, 6], statistic: 'correlation' })).numericResult, 1);
});

test('unit converter handles time units too', async () => {
  assert.equal((await unitConversionTool.execute({ value: 2, fromUnit: 'hours', toUnit: 'seconds' })).numericResult, 7200);
});

test('calculator returns 1200 for 25 times 48 with deterministic provenance', async () => {
  const result = await run('Calculate 25 × 48.');
  const calculation = result.execution.find((item) => item.numericResult !== undefined);
  assert.equal(calculation.numericResult, 1200);
  assert.deepEqual(calculation.source, { type: 'tool', id: 'math.calculator', deterministic: true });
  assert.ok(result.traceText.includes('[TOOL INPUT]'));
  assert.ok(result.traceText.includes('numericResult=1200'));
});

test('unit converter returns 5000 meters for 5 kilometers', async () => {
  const result = await run('Convert 5 km to meters.');
  const converted = result.execution.find((item) => item.type === 'unit_conversion');
  assert.equal(converted.numericResult, 5000);
  assert.equal(converted.to.unit, 'm');
});

test('structured physics input calculates force as 15 newtons', async () => {
  const result = await run('Calculate force when mass is 5 kg and acceleration is 3 m/s².');
  const force = result.execution.find((item) => item.type === 'physics_result');
  assert.equal(force.numericResult, 15);
  assert.equal(force.unit, 'N');
  assert.equal(force.equation, 'F = m * a');
});

test('equation plot returns structured graph points and visualization data', async () => {
  const result = await run('Plot y = x².');
  const graph = result.execution.find((item) => item.type === 'graph_data');
  assert.equal(graph.numericData.length, 41);
  assert.equal(graph.numericData[20].x, 0);
  assert.equal(graph.numericData[20].y, 0);
  assert.equal(result.outputs.visual.structuredVisualScenes.type, 'graph');
  assert.equal(result.outputs.visual.structuredVisualScenes.series[0].points.length, 41);
});

test('statistics tool computes the mean of the requested data', async () => {
  const result = await run('Calculate the mean of [2,4,6,8].');
  assert.equal(result.execution.find((item) => item.metadata.capability === 'statistics.analyze').numericResult, 5);
});

test('statistics tool computes population standard deviation', async () => {
  const result = await run('Calculate the standard deviation of [2,4,6,8].');
  const deviation = result.execution.find((item) => item.metadata.capability === 'statistics.analyze').numericResult;
  assert.ok(Math.abs(deviation - Math.sqrt(5)) < 1e-12);
});

test('force plot executes its explicit range, physics, plot, and scene dependencies in order', async () => {
  const result = await run('Plot force as mass changes from 1 to 10 kg with acceleration 5 m/s².');
  assert.deepEqual(result.plan.steps.filter((step) => step.capability).map((step) => step.id), ['input-generation', 'physics-calculation', 'plot-generation', 'visual-output']);
  assert.deepEqual(result.plan.steps.find((step) => step.id === 'physics-calculation').dependsOn, ['input-generation']);
  assert.deepEqual(result.plan.steps.find((step) => step.id === 'plot-generation').dependsOn, ['input-generation', 'physics-calculation']);
  assert.deepEqual(result.plan.steps.find((step) => step.id === 'visual-output').dependsOn, ['plot-generation']);
  const series = result.execution.find((item) => item.type === 'physics_series');
  assert.deepEqual(series.values, [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
  assert.equal(result.outputs.visual.structuredVisualScenes.series[0].points.length, 10);
});

test('tool failures become structured errors and preserve tool provenance', async () => {
  const result = await run('Calculate 1 / 0.');
  const error = result.execution.find((item) => item.status === 'error');
  assert.equal(result.status, 'partial');
  assert.equal(error.source.type, 'tool');
  assert.equal(error.source.id, 'math.calculator');
  assert.match(error.error, /Division by zero/);
  assert.equal(result.outputs.errors[0].message, error.error);
});
