import { mockSemanticInterpreter } from '../bikting/core/adapters/mockSemanticInterpreter.js';
import { BiktingOrchestrator, formatTrace } from '../bikting/core/orchestrator/BiktingOrchestrator.js';
import { createDefaultRegistries } from '../bikting/core/registry/createDefaultRegistries.js';
import { RelationshipEngine } from '../bikting/core/relationships/RelationshipEngine.js';
import { createExecutionResult } from '../bikting/core/types/executionResult.js';
import { createSemanticObject } from '../bikting/core/types/semantic.js';
import { createWorkspaceProjection } from './workspaceProjection.js';

/**
 * Production composition root for a Bikting request. Adapters and registries
 * are injectable so AI interpretation, knowledge retrieval, and external
 * providers can be introduced without changing the browser or workspace.
 */
export class BiktingRuntime {
  constructor({ interpret = mockSemanticInterpreter, tools, models, relationshipEngine = new RelationshipEngine(), logger = null } = {}) {
    const defaults = tools && models ? null : createDefaultRegistries();
    this.orchestrator = new BiktingOrchestrator({
      interpret,
      tools: tools ?? defaults.tools,
      models: models ?? defaults.models,
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
