import { previewIntent } from './src/server/intentPreview.js';
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
import { listVisualTools } from './src/visualization/visualToolCatalog.js';
import { mockSemanticInterpreter } from './src/bikting/core/adapters/mockSemanticInterpreter.js';
import { createKnowledgeStore } from './src/server/knowledgeStore.js';
import { createProviderConnections } from './src/server/providerConnections.js';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const plotlyBundle = resolve(root, 'node_modules/plotly.js-dist-min/plotly.min.js');
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

/** Compose the HTTP boundary without starting a process-level listener. */
export function createBiktingServer({ env = process.env, rootDir = root, logger = console } = {}) {
  const geminiEnabled = Boolean(env.GEMINI_API_KEY);
  const testToken = env.BIKTING_TEST_TOKEN;
  if (geminiEnabled && (!testToken || testToken.length < 16)) throw new Error('BIKTING_TEST_TOKEN must have at least 16 characters when Gemini is enabled.');
  const defaults = createDefaultRegistries();
  const knowledgeStore = createKnowledgeStore({ filePath: env.KNOWLEDGE_STORE_PATH ?? resolve(rootDir, 'data/knowledge-cache.json'), ttlMs: Number(env.KNOWLEDGE_CACHE_TTL_MS ?? 86_400_000) });
  const providers = createProviderConnections({ env });
  const models = new ModelRegistry();
  if (geminiEnabled) models.register(createModelAdapter({
    id: 'gemini.interpretation-text', name: 'Gemini interpretation text', domain: 'language', modalities: ['text'], capabilities: ['text.generate'],
    metadata: { provider: 'gemini' }, methods: { async generate(semantic) { return { type: 'explanation', text: semantic.context.geminiExplanation || 'The request was interpreted, but no explanation was returned.' }; } }
  }));
  for (const model of defaults.models.list()) models.register(model);
  const interpret = geminiEnabled ? createGeminiInterpreter({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || 'gemini-2.5-flash', knowledgeStore }) : mockSemanticInterpreter;
  const runtime = createBiktingRuntime({ interpret, tools: defaults.tools, models });
  const handler = createRequestHandler({ env, rootDir, plotlyBundle, defaults, runtime, interpret, geminiEnabled, testToken, providers });
  const server = createServer(handler);
  return { server, host: env.HOST ?? '0.0.0.0', port: Number(env.PORT ?? 8000), interpreter: geminiEnabled ? 'gemini' : 'mock' };
}

export function startBiktingServer(options = {}) {
  const composed = createBiktingServer(options);
  composed.server.listen(composed.port, composed.host, () => options.logger?.log?.(`Bikting Engine workspace listening on ${composed.host}:${composed.port}`) ?? console.log(`Bikting Engine workspace listening on ${composed.host}:${composed.port}`));
  return composed;
}

function createRequestHandler({ env, rootDir, plotlyBundle, defaults, runtime, interpret, geminiEnabled, testToken, providers }) {
  return async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname === '/api/run' || pathname === '/api/run/stream' || pathname === '/api/intent') {
        if (request.method !== 'POST') return send(response, 405, null);
        if (testToken && !validToken(request.headers['x-bikting-test-token'], testToken)) return send(response, 401, null);
        if (request.headers['content-type']?.split(';')[0] !== 'application/json') return send(response, 415, null);
        const input = await readInput(request);
        if (!validInput(input)) return send(response, 400, null);
        const normalized = { text: input.text.trim(), knowledgeMode: input.knowledgeMode === 'web' ? 'web' : 'model', sketch: input.sketch ?? null, sketchLayout: input.sketchLayout ?? null, modality: 'text' };
        if (pathname === '/api/run/stream') return streamRun(response, normalized, runtime, interpret, geminiEnabled);
        if (pathname === '/api/intent') {
          try { return send(response, 200, await previewIntent(normalized, interpret, geminiEnabled)); }
          catch (error) { return send(response, 503, { error: error instanceof Error ? error.message : String(error) }); }
        }
        const result = await runtime.run({ type: 'text', ...normalized, source: 'browser' });
        return send(response, result.status === 'error' ? 502 : 200, result);
      }
      if (pathname === '/health') return send(response, 200, { status: 'ok', interpreter: geminiEnabled ? 'gemini' : 'mock' });
      if (pathname === '/api/capabilities') return send(response, 200, defaults.tools.capabilityCatalog().map(({ id, domain, operation, acceptedInputs, producedOutputs }) => ({ id, domain, operation, acceptedInputs, producedOutputs })));
      if (pathname === '/api/visual-tools') return send(response, 200, listVisualTools());
      if (pathname === '/api/providers' && request.method === 'GET') return send(response, 200, providers.list());
      if (pathname.startsWith('/api/providers/') && pathname.endsWith('/connect')) {
        const providerId = pathname.slice('/api/providers/'.length, -'/connect'.length);
        if (request.method === 'POST') return send(response, 200, providers.connect(providerId));
        if (request.method === 'DELETE') return send(response, 200, providers.disconnect(providerId));
        return send(response, 405, null);
      }
      if (pathname === '/vendor/plotly.min.js') { response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=86400' }); response.end(await readFile(plotlyBundle)); return; }
      const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
      const path = resolve(rootDir, relativePath);
      if (path !== rootDir && !path.startsWith(rootDir + sep)) throw new Error('Not found');
      const publicFile = relativePath === 'index.html' || relativePath === 'styles.css' || (relativePath.startsWith('src/') && !relativePath.startsWith('src/server/') && ['.js', '.json', '.svg'].includes(extname(relativePath)) && !relativePath.split('/').some((segment) => segment.startsWith('.')));
      if (!publicFile) throw new Error('Not found');
      const body = await readFile(path);
      response.writeHead(200, { 'Content-Type': mimeTypes[extname(path)] ?? 'application/octet-stream' }); response.end(body);
    } catch (error) {
      if (!response.headersSent) send(response, error?.statusCode === 413 ? 413 : 404, null); else response.destroy();
    }
  };
}

async function readInput(request) {
  let body = '';
  for await (const chunk of request) { body += chunk; if (body.length > 600000) { const error = new Error('Request body is too large.'); error.statusCode = 413; throw error; } }
  try { return JSON.parse(body); } catch { return null; }
}

function validInput(input) {
  return typeof input?.text === 'string' && Boolean(input.text.trim()) && input.text.length <= 2000 && (input.knowledgeMode === undefined || input.knowledgeMode === 'model' || input.knowledgeMode === 'web') && (input.sketch === undefined || input.sketch === null || typeof input.sketch === 'string' && input.sketch.length <= 500000) && (input.sketchLayout === undefined || input.sketchLayout === null || typeof input.sketchLayout === 'object' && !Array.isArray(input.sketchLayout) && Array.isArray(input.sketchLayout.pieces));
}

async function streamRun(response, request, runtime, interpret, geminiEnabled) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const event = (type, data) => response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  try {
    event('stage', { stage: 'input', message: 'Request accepted.' });
    event('stage', { stage: 'intent', message: 'Resolving intent and relationships.' });
    const preview = await previewIntent(request, interpret, geminiEnabled);
    event('intent', preview);
    if (preview.status === 'clarification') { event('complete', { status: 'clarification', preview }); response.end(); return; }
    event('stage', { stage: 'execution', message: 'Routing tools and executing the plan.' });
    const result = await runtime.run({ type: 'text', ...request, source: 'browser' });
    event('result', result);
    event('complete', { status: result.status });
  } catch (error) { event('error', { message: error instanceof Error ? error.message : String(error) }); }
  response.end();
}

function send(response, status, payload) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(payload === null ? '' : JSON.stringify(payload)); }
function validToken(provided, expected) { if (typeof provided !== 'string') return false; const left = Buffer.from(provided); const right = Buffer.from(expected); return left.length === right.length && timingSafeEqual(left, right); }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startBiktingServer();
