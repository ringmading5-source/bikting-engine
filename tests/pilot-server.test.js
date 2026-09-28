import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

async function startServer(env = {}) {
  const child = spawn(process.execPath, ['--experimental-loader', './scripts/extensionless-loader.mjs', 'server.js'], {
    cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const port = await new Promise((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${log}`)), 10000);
    child.stdout.on('data', (chunk) => { log += chunk; const match = /listening on [^:]+:(\d+)/.exec(log); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited with ${code}: ${log}`)); });
  });
  return { base: `http://127.0.0.1:${port}`, stop: () => child.kill() };
}

test('server serves only browser assets and blocks source files', async () => {
  const server = await startServer();
  try {
    assert.equal((await fetch(server.base)).status, 200);
    assert.equal((await fetch(`${server.base}/src/main.js`)).status, 200);
    assert.equal((await fetch(`${server.base}/package.json`)).status, 404);
    assert.equal((await fetch(`${server.base}/src/runtime/bikting-owned-tools.ts`)).status, 404);
    assert.equal((await fetch(`${server.base}/node_modules/typescript/package.json`)).status, 404);
  } finally { server.stop(); }
});

test('pilot mode requires credentials and limits repeated requests', async () => {
  const server = await startServer({ PILOT_MODE: 'true', PILOT_USERNAME: 'tester', PILOT_PASSWORD: 'a-long-test-password' });
  try {
    assert.equal((await fetch(`${server.base}/healthz`)).status, 200);
    assert.equal((await fetch(server.base)).status, 401);
    const authorization = `Basic ${Buffer.from('tester:a-long-test-password').toString('base64')}`;
    assert.equal((await fetch(server.base, { headers: { Authorization: authorization } })).status, 200);
    let last;
    for (let index = 0; index < 119; index++) last = await fetch(server.base, { headers: { Authorization: authorization } });
    assert.equal(last.status, 429);
  } finally { server.stop(); }
});

test('live calculation streams actual provider and verification events before its result', async () => {
  const server = await startServer();
  try {
    const response = await fetch(`${server.base}/api/calculate/live`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expression: '125 * 48' }) });
    assert.equal(response.status, 200);
    const entries = (await response.text()).trim().split('\n').map(JSON.parse);
    const events = entries.filter(({ kind }) => kind === 'event').map(({ event }) => event.type);
    assert.ok(events.indexOf('provider_invoked') < events.indexOf('verification_started'));
    assert.ok(events.indexOf('verification_started') < events.indexOf('step_succeeded'));
    assert.equal(entries.at(-1).result.value, 6000);
    assert.equal(entries.at(-1).result.verified, true);
    assert.equal((await fetch(`${server.base}/src/workspace/mathVisual.js`)).status, 200);
  } finally { server.stop(); }
});

test('website tool streams canonical events and validated files', async () => {
  const server = await startServer();
  try {
    const text = 'Build for me my personal website';
    const previewResponse = await fetch(`${server.base}/api/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    const preview = await previewResponse.json();
    const response = await fetch(`${server.base}/api/scaffold/live`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, planId: preview.plan.id }) });
    assert.equal(response.status, 200);
    const entries = (await response.text()).trim().split('\n').map(JSON.parse);
    assert.ok(entries.some(({ event }) => event?.type === 'provider_invoked' && event.providerId === 'local.website-scaffold'));
    assert.ok(entries.some(({ event }) => event?.type === 'step_succeeded'));
    assert.equal(entries.at(-1).result.validated, true);
    assert.deepEqual(Object.keys(entries.at(-1).result.files).sort(), ['index.html', 'script.js', 'styles.css']);
  } finally { server.stop(); }
});

test('LLM worker stays disabled without server credentials', async () => {
  const server = await startServer({ GEMINI_API_KEY: '', GEMINI_MODEL: '' });
  try {
    const route = await fetch(`${server.base}/api/route`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Calculate 2 + 2' }) });
    assert.equal((await route.json()).workerAvailable, false);
    const response = await fetch(`${server.base}/api/agent/live`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal: 'Calculate 2 + 2' }) });
    assert.equal(response.status, 400);
  } finally { server.stop(); }
});
