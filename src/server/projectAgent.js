import { readFile, realpath, stat, writeFile, rename, unlink, link } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileHash } from './codingAgent.js';
import { createTaskAgent } from './taskAgent.js';

const exec = promisify(execFile);
// Do not inherit test-runner mode, preloads, or application credentials.
const childEnvironment = { PATH: process.env.PATH ?? '/usr/bin:/bin' };
const inside = (root, target) => { const path = relative(root, target); return path && !path.startsWith('..') && !isAbsolute(path); };
const readOptional = async path => { try { return await readFile(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };

/** Bounded change sets plus operator-registered test files; no caller commands. */
export async function runProjectAgent({ workspace, memory, changes, testFiles = [], maxSteps = 6, onVerified }) {
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > 8 || !Array.isArray(testFiles) || testFiles.length > 8) throw new TypeError('Supply 1..8 changes and at most 8 registered test files.');
  const root = await realpath(workspace);
  const entries = [], targets = new Set();
  let bytes = 0;
  for (const change of changes) {
    if (!change || typeof change.path !== 'string' || isAbsolute(change.path) || !/\.(?:js|mjs|cjs)$/.test(change.path) || typeof change.content !== 'string' || !(change.expectedHash === null || /^[a-f0-9]{64}$/.test(change.expectedHash ?? ''))) throw new TypeError('Each JS change requires content and an expected hash, or null for a new file.');
    bytes += Buffer.byteLength(change.content);
    if (Buffer.byteLength(change.content) > 100000 || bytes > 200000) throw new TypeError('Change set exceeds its byte budget.');
    const lexical = resolve(root, change.path);
    const parent = await realpath(dirname(lexical));
    const target = resolve(parent, lexical.slice(dirname(lexical).length + 1));
    if (!inside(root, target) || targets.has(target)) throw new TypeError('Changes must have distinct workspace paths.');
    targets.add(target);
    const original = await readOptional(target);
    if (original !== null && await realpath(target) !== target) throw new TypeError('Edited files cannot be symlinks.');
    if (original !== null && original.length > 100000) throw new TypeError('Existing file exceeds its byte budget.');
    if ((original === null ? null : fileHash(original)) !== change.expectedHash) throw new Error('Change-set observation is stale.');
    entries.push({ ...change, target, lexical, parent, original, mode: original === null ? 0o644 : (await stat(target)).mode, desiredHash: fileHash(change.content) });
  }
  const checks = [];
  for (const path of testFiles) {
    if (typeof path !== 'string' || isAbsolute(path) || !/\.(?:js|mjs|cjs)$/.test(path)) throw new TypeError('Registered tests must be relative JavaScript files.');
    const target = await realpath(resolve(root, path));
    if (!inside(root, target) || targets.has(target)) throw new TypeError('Registered checks must be inside the workspace and outside this change set.');
    const data = await readFile(target);
    if (data.length > 100000) throw new TypeError('Registered check exceeds its byte budget.');
    checks.push({ path, target, hash: fileHash(data) });
  }
  const currentHashes = async () => {
    const hashes = [];
    for (const entry of entries) {
      if (await realpath(dirname(entry.lexical)) !== entry.parent) throw new Error('Workspace parent changed.');
      const data = await readOptional(entry.target);
      if (data !== null && await realpath(entry.target) !== entry.target) throw new Error('Workspace file became a symlink.');
      hashes.push(data === null ? null : fileHash(data));
    }
    return hashes;
  };
  let syntaxReceipt = null, testReceipt = null;
  const receipt = hashes => JSON.stringify(hashes);
  const originals = entries.map(entry => entry.expectedHash);
  const desired = entries.map(entry => entry.desiredHash);
  const applied = [];
  const staged = [];
  const rollback = async () => {
    const conflicts = [];
    for (const entry of [...applied].reverse()) {
      try {
        if (await realpath(dirname(entry.lexical)) !== entry.parent || fileHash(await readFile(entry.target)) !== entry.desiredHash || await realpath(entry.target) !== entry.target) { conflicts.push(entry.path); continue; }
        if (entry.original === null) await unlink(entry.target);
        else {
          const temporary = resolve(entry.parent, `.bstae-restore-${randomUUID()}${extname(entry.target)}`);
          try { await writeFile(temporary, entry.original, { flag: 'wx', mode: entry.mode }); await rename(temporary, entry.target); }
          finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
        }
      } catch { conflicts.push(entry.path); }
    }
    return { status: conflicts.length ? 'conflict' : 'restored', conflicts };
  };
  const tools = new Map([
    ['project.apply', { async execute() {
      // Validate every candidate before changing any destination.
      if (receipt(await currentHashes()) !== receipt(originals)) throw new Error('Concurrent change; edit stopped.');
      for (const entry of entries) {
        const temporary = resolve(entry.parent, `.bstae-stage-${randomUUID()}${extname(entry.target)}`);
        staged.push(temporary);
        await writeFile(temporary, entry.content, { flag: 'wx', mode: entry.mode });
        await exec(process.execPath, ['--check', temporary], { cwd: root, env: childEnvironment, timeout: 5000, maxBuffer: 16000 });
      }
      if (receipt(await currentHashes()) !== receipt(originals)) throw new Error('Concurrent change; edit stopped.');
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        if ((await currentHashes())[index] !== entry.expectedHash) throw new Error('Concurrent change during apply.');
        if (entry.original === null) await link(staged[index], entry.target); // Exclusive creation.
        else await rename(staged[index], entry.target);
        applied.push(entry);
      }
      return { files: entries.map(entry => ({ path: entry.path, sha256: entry.desiredHash })) };
    } }],
    ['project.syntax', { async execute() {
      const before = await currentHashes();
      for (const entry of entries) await exec(process.execPath, ['--check', entry.target], { cwd: root, env: childEnvironment, timeout: 5000, maxBuffer: 16000 });
      if (receipt(await currentHashes()) !== receipt(before)) throw new Error('Files changed during syntax checks.');
      syntaxReceipt = receipt(before);
      return { check: 'node --check', files: entries.map(entry => entry.path) };
    } }],
    ['project.tests', { async execute() {
      if (!checks.length) throw new Error('No project checks are registered.');
      const before = await currentHashes();
      for (const check of checks) if (await realpath(check.target) !== check.target || fileHash(await readFile(check.target)) !== check.hash) throw new Error('Registered test changed.');
      const result = await exec(process.execPath, ['--test', ...checks.map(check => check.target)], { cwd: root, env: childEnvironment, timeout: 10000, maxBuffer: 64000 });
      for (const check of checks) if (await realpath(check.target) !== check.target || fileHash(await readFile(check.target)) !== check.hash) throw new Error('Registered test changed during execution.');
      if (receipt(await currentHashes()) !== receipt(before)) throw new Error('Files changed during project checks.');
      testReceipt = receipt(before);
      return { check: 'node --test', tests: checks.map(check => check.path), output: result.stdout.slice(-8000) };
    } }],
  ]);
  const observe = async () => {
    const hashes = await currentHashes();
    let checksUnchanged = true;
    for (const check of checks) if (await realpath(check.target) !== check.target || fileHash(await readFile(check.target)) !== check.hash) checksUnchanged = false;
    return { filesMatch: receipt(hashes) === receipt(desired), syntaxValid: syntaxReceipt === receipt(hashes), testsPassed: checks.length > 0 && checksUnchanged && testReceipt === receipt(hashes) };
  };
  let result;
  try {
    result = await createTaskAgent({ memory, tools, observe, onVerified }).run({ goals: { filesMatch: true, syntaxValid: true, ...(checks.length ? { testsPassed: true } : {}) }, context: { agent: 'coding-project-v1' }, maxSteps });
    if (result.status !== 'completed') { result.rollback = await rollback(); result.state = await observe(); }
    return { ...result, checks: { syntaxPassed: result.state?.syntaxValid === true, projectTestsConfigured: checks.length > 0, projectTestsPassed: result.state?.testsPassed === true }, files: entries.map(entry => entry.path) };
  } catch (error) {
    const restored = await rollback();
    return { status: 'failed', reason: error.message, rollback: restored, files: entries.map(entry => entry.path), modelCalls: 0 };
  } finally {
    for (const path of staged) await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
