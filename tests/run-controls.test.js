import test from 'node:test';
import assert from 'node:assert/strict';
import { createBiktingRuntime } from '../src/runtime/BiktingRuntime.js';
import { approvalFor, verifyResult } from '../src/bikting/core/execution/runControls.js';
import { ToolRegistry } from '../src/bikting/core/tools/ToolRegistry.js';
import { ToolExecutor } from '../src/bikting/core/execution/ToolExecutor.js';

test('routine calculations provide checkable evidence and usage without invented prices', async () => {
  const result = await createBiktingRuntime().run({ type: 'text', text: 'Calculate 2 + 3' });
  const calculated = result.execution.find((item) => item.metadata?.capability === 'math.calculate');
  assert.equal(calculated.verification.status, 'verified');
  assert.equal(result.usage.modelCalls, 0);
  assert.ok(result.usage.deterministicToolCalls >= 1);
  assert.equal(result.usage.estimatedCostUsd, null);
});

test('a generated website has a matching output and preview', async () => {
  const result = await createBiktingRuntime().run({ text: 'Build me a website for school', type: 'text' });
  assert.equal(result.execution.find((item) => item.metadata?.capability === 'website.build').verification.status, 'verified');
  assert.equal(result.status, 'completed');
});

test('side effects need explicit approval; even a completed provider claim is checked', () => {
  assert.equal(approvalFor({ capability: 'website.deploy' }, {}).status, 'approval_required');
  assert.equal(approvalFor({ capability: 'website.deploy' }, { approvedCapabilities: ['website.deploy'] }), null);
  assert.equal(verifyResult({ capability: 'website.build' }, { status: 'completed', html: 'done' }).status, 'failed');
});

test('the executor rejects a tool without the required input before invoking it', async () => {
  let invoked = false;
  const tools = new ToolRegistry();
  tools.register({ id: 'test.tool', name: 'Test', domain: 'test', capabilities: ['test.do'], inputSchema: { type: 'object', required: ['value'] }, async execute() { invoked = true; return {}; } });
  const result = await new ToolExecutor(tools).execute('test.tool', {}, { semanticObject: { id: 's', entities: [], relationships: [], provenance: [] } }, { capability: 'test.do' });
  assert.equal(result.status, 'error');
  assert.match(result.error, /requires input value/);
  assert.equal(invoked, false);
});
