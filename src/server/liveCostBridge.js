import { createHash } from 'node:crypto';
import { SearchRouter } from '../../.runtime-build/src/search/search.router.js';
import { ValidatedExperienceSearchProvider, CostTelemetry } from '../../.runtime-build/src/workers/execution-memory.js';
import { IntelligenceProviderRegistry } from '../../.runtime-build/src/intelligence/intelligence-provider.registry.js';
import { WorkerModelRouter } from '../../.runtime-build/src/workers/worker-routing.js';
import { WorkerExecutor } from '../../.runtime-build/src/workers/worker-execution.js';
import { refreshReady, transitionTask } from '../../.runtime-build/src/projects/task-graph.js';
import { validateGeneratedWebsite } from './buildPrompt.js';
import { pilotRecord } from './pilotMetrics.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stableRequest = request => ({ text: request.text, language: request.language, knowledgeMode: request.knowledgeMode, sketch: request.sketch, sketchLayout: request.sketchLayout, projectContext: request.projectContext });

export function createLiveCostBridge({ knowledgeStore, tools, env, fetchImpl = fetch }) {
  const telemetry = new CostTelemetry();
  const memory = {
    async find(query, projectId) {
      const record = await knowledgeStore.get(`validated:${projectId}:${query}`);
      return record?.validation?.valid ? [record] : [];
    },
    async store(record) {
      if (!record.validation.valid) throw new Error('Unvalidated result cannot be stored.');
      await knowledgeStore.set(`validated:${record.projectId}:${record.intent}`, record);
    },
  };
  const search = new SearchRouter();
  search.register(new ValidatedExperienceSearchProvider('validated-store', memory));
  search.register({ id: 'capability-catalog', source: 'capability_registry', available: true, async search(request) {
    return tools.capabilityCatalog().filter(item => request.query.toLowerCase().includes(item.id.toLowerCase())).slice(0, 5).map(item => ({
      id: item.id, source: 'capability_registry', relevance: 0.8, confidence: 1, provenance: { sourceId: 'capability-catalog', validated: true },
      content: { id: item.id, domain: item.domain, operation: item.operation }, estimatedTokens: 45, resolvesRequest: false,
    }));
  } });

  const run = async (runtime, request) => {
    const started = Date.now();
    const finish = async result => {
      const record = pilotRecord(result, Date.now() - started);
      await knowledgeStore.recordPilot(record);
      return { ...result, pilotRunId: record.id };
    };
    const key = digest({ version: 'read-only-v2', model: env.GEMINI_MODEL || 'gemini-2.5-flash', request: stableRequest(request) });
    if (request.knowledgeMode !== 'web') {
      const found = await search.search({ query: key, projectId: 'workspace', sources: ['validated_experience'] });
      if (found.status === 'resolved') {
        telemetry.recordResolution('cache');
        const result = structuredClone(found.results[0].content);
        return finish({ ...result, usage: { ...result.usage, modelCalls: 0, inputTokens: 0, outputTokens: 0, cacheHit: true, estimatedCostUsd: 0 } });
      }
    }
    const result = await runtime.run(request);
    if (request.knowledgeMode !== 'web' && result.status === 'completed' && result.usage?.modelCalls > 0 &&
      result.execution?.length && result.execution.every(item => item.metadata?.kind === 'engine' ||
        (['website.build', 'text.summarize', 'text.compare', 'math.calculate', 'physics.calculate_force', 'vector.calculate', 'units.convert', 'visual.scene'].includes(item.metadata?.capability) && item.verification?.status === 'verified'))) {
      await memory.store({ id: key, projectId: 'workspace', taskId: key, intent: key, relationships: result.semantic?.relationships?.map(({ from, relation, to }) => `${from}:${relation}:${to}`) ?? [],
        capabilityIds: result.selectedCapabilities ?? [], evidenceIds: [], result, validation: { valid: true, issues: [], method: 'runtime_verification' }, repairHistory: [], recordedAt: new Date().toISOString() });
    }
    return finish(result);
  };

  const inputRate = Number(env.GEMINI_INPUT_COST_PER_MILLION);
  const outputRate = Number(env.GEMINI_OUTPUT_COST_PER_MILLION);
  const pricingConfigured = env.GEMINI_INPUT_COST_PER_MILLION !== undefined && env.GEMINI_OUTPUT_COST_PER_MILLION !== undefined && Number.isFinite(inputRate) && Number.isFinite(outputRate) && inputRate >= 0 && outputRate >= 0;
  const recordModelCall = ({ taskId, model, inputTokensEstimated, inputTokensActual, outputTokens = 0, latencyMs, attempt, status }) => {
    const estimatedCost = pricingConfigured ? ((inputTokensActual ?? inputTokensEstimated) * inputRate + outputTokens * outputRate) / 1_000_000 : null;
    telemetry.record({ provider: 'gemini', model, taskId, inputTokensEstimated, inputTokensActual, outputTokens, estimatedCost, latencyMs, attempt, validationResult: status });
    return estimatedCost;
  };
  const executeWebsite = pricingConfigured ? createWebsiteWorker({ env, fetchImpl, search, memory, telemetry, inputRate, outputRate, knowledgeStore }) : null;
  return { run, executeWebsite, telemetry, search, pricingConfigured, recordModelCall };
}

function createWebsiteWorker({ env, fetchImpl, search, memory, telemetry, inputRate, outputRate, knowledgeStore }) {
  const modelId = env.GEMINI_MODEL || 'gemini-2.5-flash';
  if (!/^[a-zA-Z0-9._-]+$/.test(modelId)) throw new Error('Invalid Gemini model name.');
  const providers = new IntelligenceProviderRegistry();
  providers.register({ id: `gemini:${modelId}`, name: modelId, capabilities: { tasks: ['code'], supportsStructuredOutput: true,
    model: { provider: 'gemini', model: modelId, coding: 'high', reasoning: 'medium', structuredOutput: true, contextWindow: 32768, maxOutputTokens: 4096,
      inputCostPerMillion: inputRate, outputCostPerMillion: outputRate } },
    async executeWorker(prompt) {
      const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`, {
        method: 'POST', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: 'Perform only the bounded website preview task. Return JSON. No scripts, external resources, forms, deployment claims, or invented personal facts.' }] },
          contents: [{ role: 'user', parts: [{ text: JSON.stringify(prompt) }] }], generationConfig: { maxOutputTokens: prompt.maxOutputTokens, responseMimeType: 'application/json',
            responseSchema: { type: 'OBJECT', properties: { html: { type: 'STRING' }, buildPlan: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['html', 'buildPlan'] } } }) });
      if (!response.ok) throw new Error(`Website worker failed (${response.status}).`);
      const payload = await response.json();
      const raw = payload.candidates?.[0]?.content?.parts?.map(part => part.text ?? '').join('');
      if (!raw) throw new Error('Website worker returned no output.');
      return { output: JSON.parse(raw), inputTokens: payload.usageMetadata?.promptTokenCount, outputTokens: (payload.usageMetadata?.candidatesTokenCount ?? 0) + (payload.usageMetadata?.thoughtsTokenCount ?? 0) };
    },
    async interpretIntent() { throw new Error('Bounded website worker cannot interpret intent.'); },
    async reason() { throw new Error('Bounded website worker cannot reason about the project.'); },
  });
  const executor = new WorkerExecutor(new WorkerModelRouter(providers), search, undefined, undefined, undefined, undefined, telemetry, memory);
  return async ({ baseline, request, prompt }) => {
    if (request.sketch) return null; // Image token size is unknown; keep the existing image path.
    const objective = `website-preview:${digest(stableRequest(request))}`;
    const maxCost = Number(env.BIKTING_WORKER_MAX_COST_USD ?? 0.05);
    const task = { id: objective, projectId: 'workspace', objective, requiredCapability: 'code', requirements: { coding: 'high', structuredOutput: true },
      inputs: { action: baseline.context.task?.action, target: baseline.context.task?.target },
      evidence: baseline.relationships.map((relationship, index) => ({ id: `relationship:${index}`, source: 'knowledge_graph', relevance: 1, confidence: 1,
        provenance: { sourceId: 'resolved-intent', validated: true }, content: relationship, estimatedTokens: Math.ceil(JSON.stringify(relationship).length / 3) })),
      constraints: ['Self-contained HTML', 'No scripts, external resources, forms, invented facts, or claims of deployment'],
      outputSchema: { type: 'object', required: ['html', 'buildPlan'] }, acceptanceCriteria: ['Complete safe HTML preview', 'Array of build steps'],
      tokenBudget: { maxInputTokens: 1800, maxOutputTokens: 700, maxAttempts: 2, maxEstimatedCost: Number.isFinite(maxCost) && maxCost >= 0 ? maxCost : 0 },
      retryPolicy: { allowTargetedRepair: true, allowEscalation: false } };
    const context = [{ id: 'build-directions', source: 'project', content: prompt, estimatedTokens: Math.ceil(prompt.length / 3), taskIds: [objective], relevance: 1 }];
    const graphKey = `task-graph:${objective}`;
    let graph = refreshReady({ projectId: objective, nodes: [{ id: objective, objective: 'Create and validate website preview', dependsOn: [], status: 'PENDING' }] });
    graph = transitionTask(graph, objective, 'RUNNING');
    await knowledgeStore.set(graphKey, graph);
    const validateOutput = output => {
      try {
        validateGeneratedWebsite(output.html);
        if (!Array.isArray(output.buildPlan)) throw new Error('Build plan must be an array.');
        return { valid: true, issues: [], method: 'website_safety' };
      } catch (error) { return { valid: false, issues: [{ code: 'website_validation', message: error.message }], method: 'website_safety' }; }
    };
    let result = await executor.run(task, { remainingCost: task.tokenBudget.maxEstimatedCost, context, validateOutput });
    let calls = [...result.telemetry];
    if (result.status === 'repair_required' && result.repairTask) {
      const remainingCost = Math.max(0, maxCost - calls.reduce((sum, call) => sum + (call.estimatedCost ?? maxCost), 0));
      const repaired = await executor.run(result.repairTask, { remainingCost, allowSearchResolution: false, validateOutput });
      calls = [...calls, ...repaired.telemetry];
      result = { ...repaired, telemetry: calls };
    }
    graph = transitionTask(graph, objective, 'VALIDATING');
    graph = transitionTask(graph, objective, result.status === 'completed' || result.status === 'resolved' ? 'COMPLETED' : 'FAILED', result.status === 'completed' || result.status === 'resolved' ? `validated:${objective}` : undefined);
    await knowledgeStore.set(graphKey, graph);
    return result;
  };
}
