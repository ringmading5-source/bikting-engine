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
