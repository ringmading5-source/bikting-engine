import { readFile, realpath, writeFile, rename, unlink, stat } from 'node:fs/promises';
import { resolve, relative, dirname, isAbsolute, extname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createTaskAgent } from './taskAgent.js';

const exec = promisify(execFile);
export const fileHash = content => createHash('sha256').update(content).digest('hex');

async function locateCodingFile(workspace, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || !/\.(?:js|mjs|cjs)$/.test(path)) throw new TypeError('A relative JavaScript path is required.');
  const root = await realpath(workspace);
  const target = await realpath(resolve(root, path));
  const inside = relative(root, target);
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new TypeError('File must remain inside the configured workspace.');
  return { root, target };
}

export async function readCodingSnapshot({ workspace, path }) {
  const { target } = await locateCodingFile(workspace, path);
  const bytes = await readFile(target);
  if (bytes.length > 100000) throw new TypeError('Existing file exceeds the coding bound.');
  return { path, content: bytes.toString('utf8'), expectedHash: fileHash(bytes) };
}

/** Fixed executors: existing-file replacement and JS syntax checking, no shell. */
export async function runCodingAgent({ workspace, memory, path, content, expectedHash, maxSteps = 4, onVerified }) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || !/\.(?:js|mjs|cjs)$/.test(path) || typeof content !== 'string' || Buffer.byteLength(content) > 100000 || !/^[a-f0-9]{64}$/.test(expectedHash ?? '')) throw new TypeError('Supply a relative JS file, bounded content, and its expected SHA-256.');
  const { root, target } = await locateCodingFile(workspace, path);
  let checkedHash = null;
  const read = async () => {
    if (await realpath(resolve(root, path)) !== target) throw new Error('Workspace path changed.');
    const data = await readFile(target);
    if (data.length > 100000) throw new Error('Existing file exceeds the coding bound.');
    return data;
  };
  const original = await read();
  const originalMode = (await stat(target)).mode;
  if (fileHash(original) !== expectedHash) throw new Error('File changed since the supplied observation.');
  const desiredHash = fileHash(content);
  const tools = new Map([
    ['file.replace', { async execute() {
      if (fileHash(await read()) !== expectedHash) throw new Error('Concurrent file change; edit stopped.');
      const temporary = resolve(dirname(target), `.bstae-${randomUUID()}${extname(target)}`);
      try {
        await writeFile(temporary, content, { flag: 'wx', mode: originalMode });
        await exec(process.execPath, ['--check', temporary], { timeout: 5000, maxBuffer: 16000 });
        if (fileHash(await read()) !== expectedHash) throw new Error('Concurrent file change; edit stopped.');
        await rename(temporary, target);
      } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      return { path, sha256: desiredHash };
    } }],
    ['file.syntax-check', { async execute() {
      const hash = fileHash(await read());
      await exec(process.execPath, ['--check', target], { timeout: 5000, maxBuffer: 16000 });
      if (fileHash(await read()) !== hash) throw new Error('File changed during syntax checking.');
      checkedHash = hash;
      return { check: 'node --check', sha256: hash };
    } }],
  ]);
  const observe = async () => {
    const hash = fileHash(await read());
    return { fileMatches: hash === desiredHash, syntaxValid: hash === checkedHash };
  };
  const agent = createTaskAgent({ memory, tools, observe, onVerified });
  return agent.run({ goals: { fileMatches: true, syntaxValid: true }, context: { agent: 'coding-v1' }, maxSteps });
}
