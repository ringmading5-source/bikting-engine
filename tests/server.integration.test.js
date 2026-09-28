import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createBiktingServer } from '../server.js';

let composed;
let base;

test('HTTP boundary exposes the tested Bikting pipeline', async () => {
  composed = createBiktingServer({ env: { PORT: '0', HOST: '127.0.0.1' }, logger: { log() {} } });
  await new Promise((resolve) => composed.server.listen(0, '127.0.0.1', resolve));
  const address = composed.server.address();
  base = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', interpreter: 'mock', boundedWebsiteWorker: false, storage: 'ephemeral_file' });

  const cell = await post('/api/intent', { text: 'cell' });
  assert.equal(cell.status, 200);
  const cellBody = await cell.json();
  assert.equal(cellBody.status, 'clarification');
  assert.equal(cellBody.choices.length, 3);

  const preview = await post('/api/intent', { text: 'Calculate dot product of [1,2] and [3,4]' });
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).status, 'ready');

  const run = await post('/api/run', { text: 'Calculate dot product of [1,2] and [3,4]' });
  assert.equal(run.status, 200);
  const result = await run.json();
  assert.equal(result.status, 'completed');
  assert.equal(result.outputs.numericData[0], 11);
  assert.ok(result.trace.some(({ section }) => section === 'EXECUTION'));

  const stream = await post('/api/run/stream', { text: 'Calculate dot product of [1,2] and [3,4]' });
  assert.equal(stream.status, 200);
  const streamText = await stream.text();
  assert.match(streamText, /event: stage/);
  assert.match(streamText, /event: result/);
  assert.ok(streamText.includes('\"numericData\":[11]'));

  const capabilities = await fetch(`${base}/api/capabilities`);
  assert.equal(capabilities.status, 200);
  assert.ok((await capabilities.json()).some(({ id }) => id === 'vector.calculate'));

  const providers = await fetch(`${base}/api/providers`);
  assert.equal(providers.status, 200);
  assert.ok((await providers.json()).some(({ id }) => id === 'github'));
  const connect = await fetch(`${base}/api/providers/github/connect`, { method: 'POST' });
  assert.equal((await connect.json()).status, 'requires_user_auth');

  const invalid = await post('/api/run', { text: 'Calculate 2 + 2', knowledgeMode: 'invalid' });
  assert.equal(invalid.status, 400);
});

after(async () => { if (composed) await new Promise((resolve) => composed.server.close(resolve)); });

function post(path, body) { return fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
