import test from 'node:test';
import assert from 'node:assert/strict';
import { runLocalCalculation } from '../src/runtime/local-calculation';

test('explicit local calculation invokes a registered provider and verifies the result', async () => {
  const result = await runLocalCalculation('125 * 48');
  assert.equal(result.value, 6000);
  assert.equal(result.providerId, 'math.calculator');
  assert.equal(result.verified, true);
});

test('local calculation rejects executable content before invoking a provider', async () => {
  await assert.rejects(runLocalCalculation('process.exit(0)'), /Only numeric arithmetic/);
  await assert.rejects(runLocalCalculation('2 / 0'), /Division by zero/);
});
