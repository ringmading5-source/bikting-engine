import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { createBiktingRuntime } from './src/runtime/BiktingRuntime.js';
import { createGeminiInterpreter } from './src/server/geminiInterpreter.js';
import { createDefaultRegistries } from './src/bikting/core/registry/createDefaultRegistries.js';
import { ModelRegistry } from './src/bikting/core/models/ModelRegistry.js';
import { createModelAdapter } from './src/bikting/core/models/adapters/ModelAdapter.js';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const port = Number(process.env.PORT ?? 8000);
const host = process.env.HOST ?? '0.0.0.0';
const geminiEnabled = Boolean(process.env.GEMINI_API_KEY);
const testToken = process.env.BIKTING_TEST_TOKEN;
if (geminiEnabled && (!testToken || testToken.length < 16)) throw new Error('BIKTING_TEST_TOKEN must have at least 16 characters when Gemini is enabled.');
const defaults = createDefaultRegistries();
const models = new ModelRegistry();
if (geminiEnabled) models.register(createModelAdapter({
  id: 'gemini.interpretation-text', name: 'Gemini interpretation text', domain: 'language', modalities: ['text'], capabilities: ['text.generate'],
  metadata: { provider: 'gemini' }, methods: { async generate(semantic) { return { type: 'explanation', text: semantic.context.geminiExplanation || 'The request was interpreted, but no explanation was returned.' }; } }
}));
for (const model of defaults.models.list()) models.register(model);
const runtime = createBiktingRuntime({ interpret: geminiEnabled ? createGeminiInterpreter({ apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' }) : undefined, tools: defaults.tools, models });
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/api/run') {
      if (request.method !== 'POST') { response.writeHead(405); response.end(); return; }
      if (testToken && !validToken(request.headers['x-bikting-test-token'], testToken)) { response.writeHead(401); response.end(); return; }
      if (request.headers['content-type']?.split(';')[0] !== 'application/json') { response.writeHead(415); response.end(); return; }
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 8192) { response.writeHead(413); response.end(); return; }
      }
      let input;
      try { input = JSON.parse(body); } catch { response.writeHead(400); response.end(); return; }
      if (typeof input?.text !== 'string' || !input.text.trim() || input.text.length > 2000) { response.writeHead(400); response.end(); return; }
      const result = await runtime.run({ type: 'text', text: input.text.trim(), source: 'browser', modality: 'text' });
      response.writeHead(result.status === 'error' ? 502 : 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(result));
      return;
    }
    if (pathname === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ status: 'ok', interpreter: geminiEnabled ? 'gemini' : 'mock' }));
      return;
    }
    if (pathname === '/api/capabilities') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(defaults.tools.capabilityCatalog().map(({ id, domain, operation, acceptedInputs, producedOutputs }) => ({ id, domain, operation, acceptedInputs, producedOutputs }))));
      return;
    }
    const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
    const path = resolve(root, relativePath);
    if (path !== root && !path.startsWith(root + sep)) throw new Error('Not found');
    const publicFile = relativePath === 'index.html' || relativePath === 'styles.css' || (relativePath.startsWith('src/') && !relativePath.startsWith('src/server/') && ['.js', '.json', '.svg'].includes(extname(relativePath)) && !relativePath.split('/').some((segment) => segment.startsWith('.')));
    if (!publicFile) throw new Error('Not found');
    const body = await readFile(path);
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(path)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});

server.listen(port, host, () => console.log(`Bikting Engine workspace listening on ${host}:${port}`));

function validToken(provided, expected) {
  if (typeof provided !== 'string') return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
