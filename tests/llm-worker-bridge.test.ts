import test from 'node:test';
import assert from 'node:assert/strict';
import { runLlmWorker, type WorkerModel } from '../src/runtime/llm-worker-bridge';
import { createGeminiWorker } from '../src/runtime/gemini-worker';

test('model proposes calculator, Bikting invokes and verifies, model sees observation', async () => {
  let rounds = 0; const events: string[] = [];
  const model: WorkerModel = { async next(context) {
    rounds++;
    assert.deepEqual(context.offeredTools.map(({ capabilityId }) => capabilityId), ['math.calculate']);
    if (!context.observations.length) return { kind: 'call', capabilityId: 'math.calculate', inputs: { expression: '125 * 48' } };
    assert.deepEqual(context.observations[0].output, { numericResult: 6000 });
    return { kind: 'final', summary: '125 × 48 = 6000' };
  } };
  const result = await runLlmWorker('Calculate 125 * 48', model, ({ type }) => events.push(type));
  assert.equal(rounds, 2); assert.equal(result.status, 'completed'); assert.equal(result.observations[0].verified, true);
  assert.deepEqual(events, ['proposal', 'tool_started', 'tool_completed', 'final']);
});

test('model cannot switch tools, alter approved inputs, or claim completion without evidence', async () => {
  await assert.rejects(runLlmWorker('Calculate 2 + 2', { async next() { return { kind: 'call', capabilityId: 'code.scaffold', inputs: {} }; } }), /outside the approved task/);
  await assert.rejects(runLlmWorker('Calculate 2 + 2', { async next() { return { kind: 'call', capabilityId: 'math.calculate', inputs: { expression: '3 + 3' } }; } }), /changed the approved/);
  await assert.rejects(runLlmWorker('Calculate 2 + 2', { async next() { return { kind: 'final', summary: 'Done' }; } }), /before a verified/);
  let rounds = 0;
  await assert.rejects(runLlmWorker('Calculate 2 + 2', { async next() { rounds++; return { kind: 'call', capabilityId: 'math.calculate', inputs: { expression: '2 + 2' } }; } }), /another tool call/);
  assert.equal(rounds, 2);
});

test('website worker can only call approved scaffold and sees validated files', async () => {
  let turns = 0;
  const result = await runLlmWorker('Build for me my personal website', { async next(context) {
    turns++;
    if (!context.observations.length) return { kind: 'call', capabilityId: 'code.scaffold', inputs: {} };
    assert.deepEqual((context.observations[0].output as { fileNames: string[] }).fileNames.sort(), ['index.html', 'script.js', 'styles.css']);
    return { kind: 'final', summary: 'The website starter files were generated.' };
  } });
  assert.equal(turns, 2); assert.equal(result.observations[0].verified, true);
});

test('Gemini worker adapter parses JSON proposals, which still require Bikting validation', async () => {
  const model = createGeminiWorker({ apiKey: 'test-key', model: 'gemini-test', fetcher: async (_url, options) => {
    assert.equal((options?.headers as Record<string, string>)['x-goog-api-key'], 'test-key');
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"kind":"call","capabilityId":"code.scaffold","inputs":{}}' }] } }] }), { status: 200 });
  } });
  await assert.rejects(runLlmWorker('Calculate 2 + 2', model), /outside the approved task/);
});
