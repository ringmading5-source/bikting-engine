import { createSemanticObject, addEntity } from '../types/semantic.js';
import { createExecutionResult } from '../types/executionResult.js';
import { RelationshipEngine } from '../relationships/RelationshipEngine.js';
import { planIntent } from '../planner/planIntent.js';
import { createExecutionContext } from '../execution/ExecutionContext.js';
import { ToolExecutor } from '../execution/ToolExecutor.js';
import { executeDependencies } from '../execution/DependencyExecutor.js';
import { approvalFor, verifyResult, summarizeUsage } from '../execution/runControls.js';

export class BiktingOrchestrator {
  constructor({ interpret, tools, models, relationshipEngine = new RelationshipEngine(), logger = null }) {
    if (typeof interpret !== 'function') throw new TypeError('An interpretation adapter is required.');
    this.interpret = interpret;
    this.tools = tools;
    this.models = models;
    this.relationshipEngine = relationshipEngine;
    this.logger = logger;
    this.toolExecutor = new ToolExecutor(tools);
  }

  async run(request) {
    const trace = [];
    const record = (section, detail) => {
      const entry = { section, detail: String(detail) };
      trace.push(entry);
      this.logger?.(`[${section}]\n${entry.detail}`);
    };
    record('INPUT', request.text ?? JSON.stringify(request));
    const interpreted = await this.interpret(request);
    const { entities = [], relationships = [], ...semanticFields } = interpreted;
    const semantic = createSemanticObject({ source: request.source ?? 'user', modality: request.modality ?? semanticFields.modality ?? 'text', ...semanticFields, provenance: [{ source: 'semantic-interpreter', method: 'adapter' }, ...(interpreted.provenance ?? [])] });
    for (const entity of entities) addEntity(semantic, entity);
    for (const relationship of relationships) this.relationshipEngine.add(semantic, relationship);
    this.relationshipEngine.updateState(semantic);
    record('SEMANTIC', `id = ${semantic.id}\nmodality = ${semantic.modality}`);
    record('INTENT', semantic.intent);
    record('CONCEPTS', semantic.concepts.join(', ') || '(none)');
    record('RELATIONSHIPS', semantic.relationships.map(({ from, relation, to }) => `${from} → ${relation} → ${to}`).join('\n') || '(none)');
    if (semantic.context.buildPrompt) record('BUILD PROMPT', semantic.context.buildPrompt);
    if (semantic.context.visualPrompt) record('VISUAL PROMPT', semantic.context.visualPrompt);
    if (semantic.context.visualProgramStatus) record('VISUAL PROGRAM', semantic.context.visualProgramStatus);
    record('VARIABLES', JSON.stringify(semantic.variables));

    const registries = { tools: this.tools, models: this.models, catalog: [...this.tools.capabilityCatalog(), ...this.models.capabilityCatalog()] };
    const plan = planIntent(semantic, registries);
    const context = createExecutionContext({ request, semanticObject: semantic, plan });
    record('PLAN', plan.steps.map((step) => `${step.id}: ${step.operation}${step.dependsOn?.length ? ` (depends on ${step.dependsOn.join(', ')})` : ''}`).join('\n') || '(no operations required)');
    record('CAPABILITIES', plan.requiredCapabilities.map(({ requiredCapability, status }) => `${requiredCapability} (${status})`).join(', ') || '(none)');
    record('REQUIRED CAPABILITIES', plan.requiredCapabilities.map(({ requiredCapability, status }) => `${requiredCapability} (${status})`).join(', ') || '(none)');
    record('SELECTED TOOLS', plan.requiredCapabilities.flatMap(({ requiredCapability, providers }) => providers.map(({ id }) => `${requiredCapability}: ${id}`)).join('\n') || '(none)');

    const execution = await executeDependencies(plan.steps, async (step) => {
      if (!step.capability) {
        const payload = step.operation === 'establish_relationships'
          ? { status: 'completed', type: 'relationship_graph', relationships: semantic.relationships, entities: semantic.entities }
          : { status: 'completed', type: 'planning_operation', operation: step.operation, concepts: semantic.concepts };
        const result = createExecutionResult({ semantic, capability: `engine.${step.operation}`, adapterId: step.provider ?? 'bikting.core', kind: 'engine', payload });
        context.intermediateResults[step.id] = result;
        return result;
      }
      const provider = step.providers?.[0];
      if (!provider) {
        const requirement = plan.requiredCapabilities.find(({ requiredCapability }) => requiredCapability === step.capability);
        const access = requirement?.access;
        const result = createExecutionResult({ semantic, capability: step.capability, adapterId: 'registry', kind: 'capability', payload: { status: 'unavailable', requiredCapability: step.capability, reason: 'No registered capability can perform this operation.' } });
        if (access?.status === 'authorization_required') {
          result.reason = access.nextAction;
          result.access = access;
          result.nextAction = access.nextAction;
        }
        context.intermediateResults[step.id] = result;
        record('TOOL', `${step.capability} → unavailable`);
        return result;
      }
      const approval = approvalFor(step, request);
      if (approval) {
        const result = createExecutionResult({ semantic, capability: step.capability, adapterId: 'bikting.approval', kind: 'engine', payload: { status: 'blocked', nextAction: approval.reason, approval } });
        context.intermediateResults[step.id] = result;
        record('APPROVAL', approval.reason);
        return result;
      }
      try {
        if (provider.kind === 'model') {
          const model = this.models.get(provider.id);
          const result = createExecutionResult({ semantic, capability: step.capability, adapterId: model.id, kind: 'model', payload: await model.execute({ semantic, request, plan, capability: step, context }) });
          context.modelResults.push(result); context.intermediateResults[step.id] = result;
          record('MODEL', `${model.id} (${step.capability}) → ${result.status}`);
          return result;
        }
        const input = this.toolExecutor.inputFor(step, context);
        record('TOOL', `${provider.id} (${step.capability})`);
        record('TOOL INPUT', `${provider.id}\n${JSON.stringify(input)}`);
        const result = await this.toolExecutor.execute(provider.id, input, context, { capability: step.capability });
        result.verification = verifyResult(step, result);
        context.toolResults.push(result); context.intermediateResults[step.id] = result;
        record('VERIFY', `${provider.id}: ${result.verification.status}${result.verification.reason ? ` (${result.verification.reason})` : ''}`);
        record('RESULT', `${provider.id}\n${summarizeResult(result)}`);
        return result;
      } catch (error) {
        const result = createExecutionResult({ semantic, capability: step.capability, adapterId: provider.id, kind: provider.kind, error });
        if (provider.kind === 'model') context.modelResults.push(result); else context.toolResults.push(result);
        context.intermediateResults[step.id] = result;
        record('EXECUTION ERROR', `${provider.id}: ${error.message}`);
        return result;
      }
    });
    record('EXECUTION', execution.map((result) => `${result.metadata?.adapterId ?? result.stepId} (${result.metadata?.capability ?? 'dependency'}) → ${result.status}`).join('\n') || '(none)');

    const unexecutedStatuses = new Set(['planned', 'unavailable', 'blocked']);
    const outputFor = (capability) => execution.find((result) => result.metadata?.capability === capability && !['error', ...unexecutedStatuses].includes(result.status)) ?? null;
    const explanation = outputFor('text.generate');
    const narration = outputFor('voice.synthesize');
    const visualResult = outputFor('visual.scene');
    const visual = visualResult ? { ...visualResult, type: 'visual_scene', renderer: 'domain_specific_or_programmatic' } : plan.capabilities.includes('visual.scene') ? execution.find((result) => result.metadata?.capability === 'visual.scene') ?? null : null;
    const outputs = {
      explanation, narration, visual,
      numericData: execution.flatMap((result) => result.numericData === undefined ? [] : [result.numericData]),
      equations: execution.flatMap((result) => result.equations ?? (result.equation ? [result.equation] : [])),
      structuredVisualScenes: execution.flatMap((result) => result.structuredVisualScenes === undefined ? [] : [result.structuredVisualScenes]),
      audioReferences: execution.flatMap((result) => result.audioReferences === undefined ? [] : [result.audioReferences]),
      images: execution.flatMap((result) => result.images === undefined ? [] : [result.images]),
      toolResults: context.toolResults,
      errors: execution.flatMap((result) => [...(result.errors ?? []), ...(result.verification?.status === 'failed' ? [{ message: result.verification.reason, capability: result.metadata?.capability }] : [])]),
      unexecuted: execution.filter((result) => unexecutedStatuses.has(result.status)),
    };
    context.metadata.completedAt = new Date().toISOString();
    const hasFailures = execution.some((result) => ['error', 'unavailable', 'blocked'].includes(result.status));
    const hasPlannedWork = execution.some((result) => result.status === 'planned');
    const hasCompletedWork = execution.some((result) => result.status === 'completed');
    const verificationFailures = execution.some((result) => result.verification?.status === 'failed');
    const status = hasFailures || verificationFailures ? 'partial' : hasPlannedWork ? (hasCompletedWork ? 'partial' : 'planned') : 'completed';
    const usage = summarizeUsage(semantic, execution, request);
    record('USAGE', `modelCalls=${usage.modelCalls}; inputTokens=${usage.inputTokens}; outputTokens=${usage.outputTokens}; deterministicToolCalls=${usage.deterministicToolCalls}`);
    record('OUTPUT', `${outputs.numericData.length ? `numeric=${JSON.stringify(outputs.numericData)}` : 'structured execution result'}\nvisual=${visual?.status ?? 'not requested'}\nprovenance=${execution.map((result) => `${result.source?.type}:${result.source?.id}`).join(', ')}`);
    record('OUTPUTS', `structured result; status=${status}; numeric=${outputs.numericData.length}; scenes=${outputs.structuredVisualScenes.length}; errors=${outputs.errors.length}; unexecuted=${outputs.unexecuted.length}`);
    return { semantic, relationships: this.relationshipEngine.graph(semantic), plan, selectedCapabilities: plan.requiredCapabilities.filter(({ providers }) => providers.length).map(({ requiredCapability }) => requiredCapability), context, execution, outputs, usage, trace, traceText: formatTrace(trace), status };
  }
}

function summarizeResult(result) {
  if (result.numericResult !== undefined) return `numericResult=${result.numericResult}${result.unit ? ` ${result.unit}` : ''}`;
  if (result.values) return `values=${JSON.stringify(result.values)}`;
  if (result.structuredVisualScenes) return `structuredVisualScenes=${result.structuredVisualScenes.type}`;
  return `${result.status}${result.error ? `: ${result.error}` : ''}`;
}

export function formatTrace(trace) { return trace.map(({ section, detail }) => `[${section}]\n${detail}`).join('\n\n'); }
