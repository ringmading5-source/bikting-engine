import { readdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const buildDirectory = new URL('../.architecture-test-build/', import.meta.url);
const loaderUrl = new URL('extensionless-loader.mjs', import.meta.url).href;

try {
  await run(process.execPath, [join('node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.architecture-tests.json']);
  const tests = (await readdir(new URL('tests/', buildDirectory)))
    .filter((name) => name.endsWith('.test.js'))
    .sort()
    .map((name) => join('.architecture-test-build', 'tests', name));
  await run(process.execPath, ['--experimental-loader', loaderUrl, '--test', ...tests]);
} finally {
  await rm(buildDirectory, { recursive: true, force: true });
}

function run(command, arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { cwd: root, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}
