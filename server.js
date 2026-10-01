import { previewIntent } from './src/server/intentPreview.js';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { createBiktingRuntime } from './src/runtime/BiktingRuntime.js';
import { createGeminiInterpreter } from './src/server/geminiInterpreter.js';
import { createDefaultRegistries } from './src/bikting/core/registry/createDefaultRegistries.js';
import { ModelRegistry } from './src/bikting/core/models/ModelRegistry.js';
import { createModelAdapter } from './src/bikting/core/models/adapters/ModelAdapter.js';
import { listVisualTools } from './src/visualization/visualToolCatalog.js';
import { mockSemanticInterpreter } from './src/bikting/core/adapters/mockSemanticInterpreter.js';
import { createKnowledgeStore } from './src/server/knowledgeStore.js';
import { createPostgresKnowledgeStore } from './src/server/postgresKnowledgeStore.js';
import { createProviderConnections } from './src/server/providerConnections.js';
import { createLiveCostBridge } from './src/server/liveCostBridge.js';
import { runProjectAgent } from './src/server/projectAgent.js';
import { proposeCode } from './src/server/codingProposal.js';
import { runCodingAgent, readCodingSnapshot } from './src/server/codingAgent.js';
import { createRelationalMemory } from './src/server/relationalMemory.js';
import { createGeminiTextTool } from './src/server/geminiTextTool.js';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const plotlyBundle = resolve(root, 'node_modules/plotly.js-dist-min/plotly.min.js');
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

/** Compose the HTTP boundary without starting a process-level listener. */
export function createBiktingServer({ env = process.env, rootDir = root, logger = console, fetchImpl = fetch } = {}) {
  const geminiEnabled = Boolean(env.GEMINI_API_KEY);
  const testToken = env.BIKTING_TEST_TOKEN;
  if (geminiEnabled && (!testToken || testToken.length < 16)) throw new Error('BIKTING_TEST_TOKEN must have at least 16 characters when Gemini is enabled.');
  const defaults = createDefaultRegistries();
  const ttlMs = Number(env.KNOWLEDGE_CACHE_TTL_MS ?? 86_400_000);
  const knowledgeStore = env.DATABASE_URL ? createPostgresKnowledgeStore({ connectionString: env.DATABASE_URL, ttlMs }) : createKnowledgeStore({ filePath: env.KNOWLEDGE_STORE_PATH ?? resolve(rootDir, 'data/knowledge-cache.json'), ttlMs });
  const relationalMemory = createRelationalMemory({ knowledgeStore });
  const providers = createProviderConnections({ env });
  const costBridge = createLiveCostBridge({ knowledgeStore, tools: defaults.tools, env, fetchImpl });
  if (geminiEnabled) defaults.tools.register(createGeminiTextTool({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || 'gemini-2.5-flash', fetchImpl, onModelCall: costBridge.recordModelCall, knowledgeStore, onMemoryHit: () => costBridge.telemetry.recordResolution('cache') }));
  const models = new ModelRegistry();
  if (geminiEnabled) models.register(createModelAdapter({
    id: 'gemini.interpretation-text', name: 'Gemini interpretation text', domain: 'language', modalities: ['text'], capabilities: ['text.generate'],
    metadata: { provider: 'gemini' }, methods: { async generate(semantic) { return { type: 'explanation', text: semantic.context.geminiExplanation || 'The request was interpreted, but no explanation was returned.', ...(semantic.context.memoryEvidence ? { source: { type: 'memory', id: 'relational_memory', deterministic: true }, memoryEvidence: semantic.context.memoryEvidence, memoryVerification: semantic.context.memoryConflict ? 'conflict' : 'operator_approved' } : {}) }; } }
  }));
  for (const model of defaults.models.list()) models.register(model);
  const providerInterpret = geminiEnabled ? createGeminiInterpreter({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || 'gemini-2.5-flash', knowledgeStore, executeWebsite: costBridge.executeWebsite, onModelCall: costBridge.recordModelCall, fetchImpl }) : mockSemanticInterpreter;
  const interpret = async request => {
    if (geminiEnabled && request.knowledgeMode !== 'web' && !request.projectContext && !request.sketch) {
      const baseline = await mockSemanticInterpreter(request);
      if (!baseline.context.task && ['unknown', 'explain'].includes(baseline.intent)) {
        const answer = await relationalMemory.answer({ query: request.text, context: { language: request.language ?? 'und' } });
        if (answer.status === 'conflict') {
          return { ...baseline, intent: 'unknown', requestedOutputs: ['explanation'], context: { ...baseline.context, geminiExplanation: 'Stored sources conflict. Review the memory records before using this answer.', memoryConflict: true, memoryEvidence: answer.candidates.map(({ record }) => ({ id: record.id, source: record.source })), modelUsage: { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 } } };
        }
        if (answer.status === 'resolved') {
          costBridge.telemetry.recordResolution('search');
          return { ...baseline, intent: 'explain', requestedOutputs: ['explanation'], context: { ...baseline.context, geminiExplanation: answer.text, memoryEvidence: answer.evidence, modelUsage: { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 } }, provenance: [{ source: 'relational_memory', method: 'exact_approved_fact' }] };
        }
      }
    }
    return providerInterpret(request);
  };
  const runtime = createBiktingRuntime({ interpret, tools: defaults.tools, models });
  const handler = createRequestHandler({ env, rootDir, plotlyBundle, defaults, runtime, interpret, geminiEnabled, testToken, providers, costBridge, knowledgeStore, relationalMemory, fetchImpl });
  const server = createServer(handler);
  return { server, host: env.HOST ?? '0.0.0.0', port: Number(env.PORT ?? 8000), interpreter: geminiEnabled ? 'gemini' : 'mock', costBridge, knowledgeStore, relationalMemory };
}

export function startBiktingServer(options = {}) {
  const composed = createBiktingServer(options);
  composed.server.listen(composed.port, composed.host, () => {
    const log = options.logger?.log?.bind(options.logger) ?? console.log;
    log(`Bikting Engine workspace listening on ${composed.host}:${composed.port}; storage selected: ${composed.knowledgeStore.mode}`);
  });
  return composed;
}

function createRequestHandler({ env, rootDir, plotlyBundle, defaults, runtime, interpret, geminiEnabled, testToken, providers, costBridge, knowledgeStore, relationalMemory, fetchImpl }) {
  let agentQueue = Promise.resolve();
  return async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname === '/api/run' || pathname === '/api/run/stream' || pathname === '/api/intent') {
        if (request.method !== 'POST') return send(response, 405, null);
        if (testToken && !validToken(request.headers['x-bikting-test-token'], testToken)) return send(response, 401, null);
        if (request.headers['content-type']?.split(';')[0] !== 'application/json') return send(response, 415, null);
        const input = await readInput(request);
        if (!validInput(input)) return send(response, 400, null);
        const normalized = { text: input.text.trim(), language: input.language ?? 'und', knowledgeMode: input.knowledgeMode === 'web' ? 'web' : 'model', sketch: input.sketch ?? null, sketchLayout: input.sketchLayout ?? null, projectContext: input.projectContext ?? null, modality: 'text' };
        if (pathname === '/api/run/stream') return streamRun(response, normalized, runtime, interpret, geminiEnabled, costBridge);
        if (pathname === '/api/intent') {
          try { return send(response, 200, await previewIntent(normalized, interpret, geminiEnabled)); }
          catch (error) { return send(response, 503, { error: error instanceof Error ? error.message : String(error) }); }
        }
        const result = await costBridge.run(runtime, { type: 'text', ...normalized, source: 'browser' });
        return send(response, result.status === 'error' ? 502 : 200, result);
      }
      if (pathname === '/api/agent/propose') {
        if (!testToken || !validToken(request.headers['x-bikting-test-token'], testToken)) return send(response, 401, null);
        if (request.method !== 'POST') return send(response, 405, null);
        if (request.headers['content-type']?.split(';')[0] !== 'application/json') return send(response, 415, null);
        if (!env.BIKTING_AGENT_WORKSPACE || !env.GEMINI_API_KEY) return send(response, 503, { error: 'Coding workspace and attached model are required.' });
        const input = await readInput(request);
        try {
          const snapshot = await readCodingSnapshot({ workspace: env.BIKTING_AGENT_WORKSPACE, path: input?.path });
          return send(response, 200, await proposeCode({ snapshot, instruction: input?.instruction, apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || 'gemini-2.5-flash', fetchImpl, onModelCall: costBridge.recordModelCall }));
        } catch (error) { return send(response, error instanceof TypeError ? 400 : 502, { error: error.message }); }
      }
      if (pathname === '/api/agent/project') {
        if (!testToken || !validToken(request.headers['x-bikting-test-token'], testToken)) return send(response, 401, null);
        if (request.method !== 'POST') return send(response, 405, null);
        if (request.headers['content-type']?.split(';')[0] !== 'application/json') return send(response, 415, null);
        if (!env.BIKTING_AGENT_WORKSPACE) return send(response, 503, { error: 'Coding workspace is not configured.' });
        let testFiles;
        try { testFiles = JSON.parse(env.BIKTING_AGENT_TEST_FILES ?? '[]'); if (!Array.isArray(testFiles)) throw Error(); }
        catch { return send(response, 503, { error: 'Registered test configuration is invalid.' }); }
        const input = await readInput(request);
        const work = agentQueue.then(async () => {
          for (const record of [
            { id: 'builtin:project-apply', tool: 'project.apply', preconditions: { filesMatch: false }, effects: { filesMatch: true } },
            { id: 'builtin:project-syntax', tool: 'project.syntax', preconditions: { filesMatch: true }, effects: { syntaxValid: true } },
            { id: 'builtin:project-tests', tool: 'project.tests', preconditions: { filesMatch: true, syntaxValid: true }, effects: { testsPassed: true } },
          ]) await relationalMemory.put({ ...record, kind: 'procedure', text: record.tool, queries: [], source: 'builtin:project-agent-v1', review: 'approved', context: { agent: 'coding-project-v1' }, expiresAt: Date.now() + 86400000 });
          const runId = randomUUID();
          const result = await runProjectAgent({ ...(input ?? {}), workspace: env.BIKTING_AGENT_WORKSPACE, memory: relationalMemory, testFiles,
            onVerified: async evidence => knowledgeStore.set(`agent-evidence:${randomUUID()}`, { ...evidence, runId, verification: 'observed_step', recordedAt: new Date().toISOString() }) });
          await knowledgeStore.set(`agent-run:${runId}`, { ...result, runId, recordedAt: new Date().toISOString() });
          return { ...result, runId };
        });
        agentQueue = work.catch(() => {});
        try { return send(response, 200, await work); }
        catch (error) { return send(response, error instanceof TypeError ? 400 : 409, { error: error.message }); }
      }
      if (pathname === '/api/agent/code') {
        if (!testToken || !validToken(request.headers['x-bikting-test-token'], testToken)) return send(response, 401, null);
        if (request.method !== 'POST') return send(response, 405, null);
        if (request.headers['content-type']?.split(';')[0] !== 'application/json') return send(response, 415, null);
        if (!env.BIKTING_AGENT_WORKSPACE) return send(response, 503, { error: 'Coding workspace is not configured.' });
        const input = await readInput(request);
        const work = agentQueue.then(async () => {
          for (const record of [
            { id: 'builtin:file-replace', tool: 'file.replace', preconditions: { fileMatches: false }, effects: { fileMatches: true } },
            { id: 'builtin:file-syntax', tool: 'file.syntax-check', preconditions: { fileMatches: true }, effects: { syntaxValid: true } },
          ]) await relationalMemory.put({ ...record, kind: 'procedure', text: record.tool, queries: [], source: 'builtin:coding-agent-v1', review: 'approved', context: { agent: 'coding-v1' }, expiresAt: Date.now() + 86400000 });
          return runCodingAgent({ ...(input ?? {}), workspace: env.BIKTING_AGENT_WORKSPACE, memory: relationalMemory, onVerified: async evidence => knowledgeStore.set(`agent-evidence:${randomUUID()}`, { ...evidence, path: input?.path, recordedAt: new Date().toISOString(), verification: 'observed' }) });
        });
        agentQueue = work.catch(() => {});
        try { return send(response, 200, await work); }
        catch (error) { return send(response, error instanceof TypeError ? 400 : 409, { error: error.message }); }
      }
      if (['/api/memory/records', '/api/memory/retrieve', '/api/memory/answer', '/api/memory/plan'].includes(pathname)) {
        if (!testToken || !validToken(request.headers['x-bikting-test-token'], testToken)) return send(response, 401, null);
        if (request.method !== 'POST' && !(pathname === '/api/memory/records' && request.method === 'DELETE')) return send(response, 405, null);
        if (request.headers['content-type']?.split(';')[0] !== 'application/json') return send(response, 415, null);
        const input = await readInput(request);
        try {
          const operation = request.method === 'DELETE' ? 'remove' : pathname.split('/').at(-1);
          const result = await relationalMemory[operation === 'records' ? 'put' : operation](input ?? {});
          return send(response, 200, result);
        } catch (error) {
          if (error instanceof TypeError || error instanceof RangeError) return send(response, 400, { error: error.message });
          return send(response, 503, { error: 'Memory storage unavailable.' });
        }
      }
      if (pathname === '/health') {
        try { await knowledgeStore.ready(); }
        catch { return send(response, 503, { status: 'storage_unavailable' }); }
        return send(response, 200, { status: 'ok', interpreter: geminiEnabled ? 'gemini' : 'mock', boundedWebsiteWorker: Boolean(costBridge.executeWebsite), storage: knowledgeStore.mode,
          ...(env.RENDER_GIT_COMMIT ? { revision: env.RENDER_GIT_COMMIT.slice(0, 7) } : {}) });
      }
      if (pathname === '/api/usage' && request.method === 'GET') {
        if (testToken && !validToken(request.headers['x-bikting-test-token'], testToken)) return send(response, 401, null);
        return send(response, 200, costBridge.telemetry.summary());
      }
      if (pathname === '/api/pilot/summary' && request.method === 'GET') {
        if (!testToken || !validToken(request.headers['x-bikting-test-token'], testToken)) return send(response, 401, null);
        return send(response, 200, await knowledgeStore.pilotSummary());
      }
      if (pathname === '/api/pilot/feedback' && request.method === 'POST') {
        if (!testToken || !validToken(request.headers['x-bikting-test-token'], testToken)) return send(response, 401, null);
        if (request.headers['content-type']?.split(';')[0] !== 'application/json') return send(response, 415, null);
        const feedback = await readInput(request);
        if (typeof feedback?.runId !== 'string' || !/^[0-9a-f-]{36}$/i.test(feedback.runId) || !Number.isInteger(feedback.rating) || feedback.rating < 1 || feedback.rating > 5 || typeof feedback.completed !== 'boolean' ||
          ![undefined, 'unclear', 'incorrect', 'incomplete', 'slow', 'other'].includes(feedback.friction)) return send(response, 400, null);
        const updated = await knowledgeStore.feedbackPilot(feedback.runId, { rating: feedback.rating, completedByUser: feedback.completed, friction: feedback.friction ?? null });
        return send(response, updated ? 200 : 404, updated ? { status: 'recorded' } : { error: 'Run not found.' });
      }
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
  return typeof input?.text === 'string' && Boolean(input.text.trim()) && input.text.length <= 2000 && (input.language === undefined || typeof input.language === 'string' && /^(?:und|[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3})$/i.test(input.language)) && (input.knowledgeMode === undefined || input.knowledgeMode === 'model' || input.knowledgeMode === 'web') && (input.sketch === undefined || input.sketch === null || typeof input.sketch === 'string' && input.sketch.length <= 500000) && (input.sketchLayout === undefined || input.sketchLayout === null || typeof input.sketchLayout === 'object' && !Array.isArray(input.sketchLayout) && Array.isArray(input.sketchLayout.pieces)) && (input.projectContext === undefined || input.projectContext === null || input.projectContext.type === 'website' && typeof input.projectContext.html === 'string' && input.projectContext.html.length <= 50000 && typeof input.projectContext.title === 'string' && input.projectContext.title.length <= 100);
}

async function streamRun(response, request, runtime, interpret, geminiEnabled, costBridge) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const event = (type, data) => response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  try {
    event('stage', { stage: 'input', message: 'Request accepted.' });
    event('stage', { stage: 'intent', message: 'Resolving intent and relationships.' });
    const preview = await previewIntent(request, interpret, geminiEnabled);
    event('intent', preview);
    if (preview.status === 'clarification') { event('complete', { status: 'clarification', preview }); response.end(); return; }
    event('stage', { stage: 'execution', message: 'Routing tools and executing the plan.' });
    const result = await costBridge.run(runtime, { type: 'text', ...request, source: 'browser' });
    event('result', result);
    event('complete', { status: result.status });
  } catch (error) { event('error', { message: error instanceof Error ? error.message : String(error) }); }
  response.end();
}

function send(response, status, payload) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(payload === null ? '' : JSON.stringify(payload)); }
function validToken(provided, expected) { if (typeof provided !== 'string') return false; const left = Buffer.from(provided); const right = Buffer.from(expected); return left.length === right.length && timingSafeEqual(left, right); }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startBiktingServer();
