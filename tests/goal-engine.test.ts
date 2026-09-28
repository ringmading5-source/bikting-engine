import test from 'node:test';
import assert from 'node:assert/strict';
import { GoalEngine } from '../src/runtime/goal-engine';
import { createGeminiGoalClarifier } from '../src/runtime/gemini-goal-clarifier';

test('local arithmetic reaches verified result without any model call', async () => {
  let modelCalls = 0; const engine = new GoalEngine({ async suggest() { modelCalls++; throw new Error('Unneeded model call'); } });
  const decision = await engine.analyze('Calculate 125 * 48');
  assert.equal(decision.status, 'ready'); assert.equal(decision.modelCalls, 0);
  const events: string[] = [];
  const result = await engine.run('Calculate 125 * 48', {}, ({ type }) => events.push(type));
  assert.equal(result.status, 'verified'); assert.equal(result.modelCalls, 0);
  assert.equal((result.result as { value: number }).value, 6000);
  assert.ok(events.includes('provider_invoked')); assert.ok(events.includes('step_succeeded')); assert.equal(modelCalls, 0);
});

test('website ambiguity asks once and refuses existing-project editing without pretending to do it', async () => {
  const engine = new GoalEngine();
  const question = await engine.analyze('Build for me my personal website');
  assert.equal(question.status, 'needs_input'); assert.equal(question.modelCalls, 0);
  assert.equal((await engine.analyze('Build for me my personal website', { websiteScope: 'existing' })).status, 'unavailable');
  await assert.rejects(engine.run('Build for me my personal website'), /Resolve the intent question/);
  const ready = await engine.analyze('Build for me my personal website', { websiteScope: 'starter' });
  assert.equal(ready.status, 'ready');
  const result = await engine.run('Build for me my personal website', { websiteScope: 'starter' });
  assert.equal(result.status, 'verified'); assert.equal(result.modelCalls, 0);
});

test('unknown wording gets one model clarification, never an automatic tool execution', async () => {
  let calls = 0;
  const engine = new GoalEngine({ async suggest() { calls++; return { inferredGoal: 'Calculate 2 + 2', category: 'calculate', question: 'Do you mean calculate 2 + 2?' }; } });
  const decision = await engine.analyze('Could you work out two plus two?');
  assert.equal(decision.status, 'needs_confirmation'); assert.equal(decision.modelCalls, 1); assert.equal(calls, 1);
  await assert.rejects(engine.run('Could you work out two plus two?'), /Resolve the intent question/);
});

test('Gemini clarification adapter makes one bounded interpretation request', async () => {
  let requests = 0;
  const clarifier = createGeminiGoalClarifier({ apiKey: 'test-key', model: 'gemini-test', fetcher: async () => {
    requests++;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"inferredGoal":"Calculate 2 + 2","category":"calculate","question":"Calculate two plus two?"}' }] } }], usageMetadata: { promptTokenCount: 25, candidatesTokenCount: 12, totalTokenCount: 37 } }), { status: 200 });
  } });
  const result = await new GoalEngine(clarifier).analyze('two plus two');
  assert.equal(result.status, 'needs_confirmation'); assert.equal(result.usage?.totalTokens, 37); assert.equal(requests, 1);
  const mathQuestion = await new GoalEngine(clarifier).analyze('What is two plus two?');
  assert.equal(mathQuestion.status, 'needs_confirmation'); assert.equal(requests, 2);
});
