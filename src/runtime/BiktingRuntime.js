import { mockSemanticInterpreter } from '../bikting/core/adapters/mockSemanticInterpreter.js';
import { BiktingOrchestrator, formatTrace } from '../bikting/core/orchestrator/BiktingOrchestrator.js';
import { createDefaultRegistries } from '../bikting/core/registry/createDefaultRegistries.js';
import { RelationshipEngine } from '../bikting/core/relationships/RelationshipEngine.js';
import { createExecutionResult } from '../bikting/core/types/executionResult.js';
import { createSemanticObject } from '../bikting/core/types/semantic.js';
import { createWorkspaceProjection } from './workspaceProjection.js';
import { parseActionSequence } from '../bikting/core/intent/parseActionSequence.js';

/**
 * Production composition root for a Bikting request. Adapters and registries
 * are injectable so AI interpretation, knowledge retrieval, and external
 * providers can be introduced without changing the browser or workspace.
 */
export class BiktingRuntime {
  constructor({ interpret = mockSemanticInterpreter, tools, models, actions, relationshipEngine = new RelationshipEngine(), logger = null } = {}) {
    const defaults = tools && models ? null : createDefaultRegistries();
    this.orchestrator = new BiktingOrchestrator({
      interpret,
      tools: tools ?? defaults.tools,
      models: models ?? defaults.models,
      actions,
      relationshipEngine,
      logger,
    });
  }

  async run(request) {
    const fallbackRequest = {
      ...request,
      text: String(request?.text ?? '').trim(),
      source: request?.source ?? 'browser',
      modality: request?.modality ?? (request?.type === 'text' ? 'text' : 'unknown'),
    };
    try {
      const normalizedRequest = normalizeRequest(fallbackRequest);
      const sequence = parseActionSequence(normalizedRequest.text);
      if (sequence.status === 'negated') throw new Error('A negated action was found. No action was run; state the positive task you want Bikting to perform.');
      if (sequence.status === 'unresolved') throw new Error('The requested action order or target is unclear. Name the target in each step, for example: Teach cells, then explore the nucleus.');
      if (sequence.actions.length > 1) {
        const results = [];
        for (const action of sequence.actions) {
          const result = attachWorkspace(await this.orchestrator.run({ ...normalizedRequest, text: action.text }));
          results.push(result);
          if (result.status !== 'completed' || result.semantic.intent === 'unknown') break;
        }
        return combineSequence(results, sequence.actions);
      }
      const result = await this.orchestrator.run(normalizedRequest);
      return attachWorkspace(result);
    } catch (error) {
      return attachWorkspace(createRuntimeFailure(fallbackRequest, error));
    }
  }
}

export function createBiktingRuntime(options) {
  return new BiktingRuntime(options);
}

function normalizeRequest(request = {}) {
  const text = String(request.text ?? '').trim();
  if (!text) throw new TypeError('A non-empty text request is required.');
  return {
    ...request,
    text,
    source: request.source ?? 'browser',
    modality: request.modality ?? (request.type === 'text' ? 'text' : 'unknown'),
  };
}

function createRuntimeFailure(request, error) {
  const message = error instanceof Error ? error.message : String(error);
  const semantic = createSemanticObject({
    source: request.source,
    modality: request.modality,
    intent: 'unknown',
    context: { requestText: request.text },
    provenance: [{ source: 'bikting-runtime', method: 'composition' }],
  });
  const failure = createExecutionResult({ semantic, capability: 'runtime.request', adapterId: 'bikting.runtime', kind: 'engine', error: new Error(message) });
  const trace = [
    { section: 'INPUT', detail: request.text },
    { section: 'RUNTIME ERROR', detail: message },
    { section: 'OUTPUTS', detail: 'structured result; status=error; errors=1' },
  ];
  return {
    semantic,
    relationships: { entities: semantic.entities, relationships: semantic.relationships },
    plan: { id: `plan-${semantic.id}`, intent: semantic.intent, semanticId: semantic.id, requiredCapabilities: [], capabilities: [], steps: [] },
    selectedCapabilities: [],
    context: { requestId: semantic.id, semanticObject: semantic, toolResults: [], modelResults: [], intermediateResults: {}, metadata: { completedAt: new Date().toISOString() } },
    execution: [failure],
    outputs: { explanation: null, narration: null, visual: null, numericData: [], equations: [], structuredVisualScenes: [], audioReferences: [], images: [], toolResults: [], errors: failure.errors, unexecuted: [] },
    trace,
    traceText: formatTrace(trace),
    status: 'error',
  };
}

function attachWorkspace(result) {
  return { ...result, workspace: createWorkspaceProjection(result) };
}

function combineSequence(results, actions) {
  const last = results.at(-1);
  const completedAll = results.length === actions.length && results.every((result) => result.status === 'completed' && result.semantic.intent !== 'unknown');
  const moments = results.flatMap((result, index) => result.workspace.moments.map((moment) => ({ ...moment,
    id: `action-${index + 1}-${moment.id}`, title: `${actions[index].family}: ${moment.title}`,
    visual: { ...moment.visual, scene: result.workspace.scene } })));
  if (!completedAll) moments.push({ id: 'sequence-paused', title: 'Work paused', display: { text: `Bikting stopped after action ${results.length}. Remaining actions were not run.` }, voice: { text: 'The remaining actions were not run.' }, visual: { state: null, scene: null }, action: null });
  const usages = results.map((result) => result.usage).filter(Boolean);
  const usage = usages.length ? { modelCalls: usages.reduce((sum, item) => sum + (item.modelCalls ?? 0), 0),
    inputTokens: usages.reduce((sum, item) => sum + (item.inputTokens ?? 0), 0),
    outputTokens: usages.reduce((sum, item) => sum + (item.outputTokens ?? 0), 0),
    deterministicToolCalls: usages.reduce((sum, item) => sum + (item.deterministicToolCalls ?? 0), 0),
    cacheHit: usages.every((item) => item.cacheHit),
    estimatedCostUsd: usages.every((item) => item.estimatedCostUsd != null) ? usages.reduce((sum, item) => sum + item.estimatedCostUsd, 0) : null } : null;
  return { ...last, status: completedAll ? 'completed' : 'partial', execution: results.flatMap((result) => result.execution),
    usage,
    trace: results.flatMap((result, index) => result.trace.map((entry) => ({ ...entry, section: `ACTION ${index + 1} / ${entry.section}` }))),
    sequence: actions.map((action, index) => ({ ...action, status: results[index]?.status ?? 'not_run' })),
    workspace: { ...last.workspace, status: completedAll ? 'completed' : 'partial', title: 'Your requested actions',
      summary: completedAll ? `${results.length} actions completed in order.` : `Stopped after action ${results.length}; remaining actions were not run.`, moments,
      steps: moments.map((moment) => ({ title: moment.title, text: moment.display.text, narration: moment.voice.text, visualState: moment.visual.state })) } };
}
