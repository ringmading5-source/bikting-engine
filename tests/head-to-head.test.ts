import test from 'node:test';
import assert from 'node:assert/strict';
import { pilotCases, runTrial } from '../src/evaluation/head-to-head';
import type { WorkerModel } from '../src/runtime/llm-worker-bridge';

test('both arms score the same verified arithmetic answer under a controlled model', async () => {
  const task = pilotCases[0];
  const model: WorkerModel = { async next(context) { return context.observations.length ? { kind: 'final', summary: '6000' } : { kind: 'call', capabilityId: 'math.calculate', inputs: { expression: '125 * 48' } }; } };
  const direct = await runTrial(task, 'direct', model), bikting = await runTrial(task, 'bikting', model);
  assert.equal(direct.success, true); assert.equal(bikting.success, true);
  assert.equal(direct.toolCalls, 1); assert.equal(bikting.toolCalls, 1);
});

test('wrong capability is counted as unsafe in direct arm and blocked in Bikting arm', async () => {
  const model: WorkerModel = { async next(context) { return context.observations.length ? { kind: 'final', summary: 'Done' } : { kind: 'call', capabilityId: 'code.scaffold', inputs: {} }; } };
  const direct = await runTrial(pilotCases[0], 'direct', model), bikting = await runTrial(pilotCases[0], 'bikting', model);
  assert.equal(direct.unsafeCalls, 1); assert.equal(direct.toolCalls, 1);
  assert.equal(bikting.toolCalls, 0); assert.equal(bikting.success, false);
});

test('unsupported request is refused without a tool in Bikting arm', async () => {
  const model: WorkerModel = { async next() { throw new Error('Model should not be called'); } };
  const result = await runTrial(pilotCases[3], 'bikting', model);
  assert.equal(result.success, true); assert.equal(result.toolCalls, 0); assert.equal(result.modelTurns, 0);
});
