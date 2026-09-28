import test from 'node:test';
import assert from 'node:assert/strict';
import { createBiktingOwnedTools } from '../src/runtime/bikting-owned-tools';

test('installed toolbox owns only executable first-party tools', () => {
  const toolbox = createBiktingOwnedTools();
  assert.deepEqual(toolbox.installed.map(({ capabilityId }) => capabilityId).sort(), ['code.scaffold', 'math.calculate']);
  for (const tool of toolbox.installed) {
    assert.equal(tool.owner, 'bikting');
    assert.equal(tool.externalAccountRequired, false);
    assert.equal(toolbox.providers.get(tool.id)?.metadata?.owner, 'bikting');
    assert.equal(toolbox.invoker.has(tool.id, tool.capabilityId), true);
  }
  assert.equal(toolbox.providers.findByCapability('knowledge.public_search').length, 0);
  assert.equal(toolbox.providers.findByCapability('code.execute').length, 0);
});
