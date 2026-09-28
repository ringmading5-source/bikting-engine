import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [join('node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.runtime.json'], { stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Runtime compile failed (${code}).`)));
});

async function fixImports(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) { await fixImports(path); continue; }
    if (!item.name.endsWith('.js')) continue;
    const source = await readFile(path, 'utf8');
    const fixed = source.replace(/(\bfrom\s*|\bimport\s*\()(["'])(\.{1,2}\/[^"']+)\2/g, (match, prefix, quote, specifier) =>
      /\.(?:js|mjs|cjs|json)$/.test(specifier) ? match : `${prefix}${quote}${specifier}.js${quote}`);
    if (fixed !== source) await writeFile(path, fixed);
  }
}
await fixImports('.runtime-build');
