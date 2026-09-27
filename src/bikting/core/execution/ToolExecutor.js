import { createExecutionResult } from '../types/executionResult.js';
import { resolveInputMapping } from './ExecutionContext.js';

export class ToolExecutor {
  constructor(registry) { this.registry = registry; }
  async execute(toolOrId, input, context, { capability } = {}) {
    const tool = typeof toolOrId === 'string' ? this.registry.get(toolOrId) : toolOrId;
    if (!tool) return createExecutionResult({ semantic: context.semanticObject, capability: capability ?? 'unknown', adapterId: String(toolOrId), kind: 'tool', payload: { status: 'unavailable', reason: `Tool is not registered: ${toolOrId}` } });
    try {
      const payload = await tool.execute(input ?? {}, context);
      return createExecutionResult({ semantic: context.semanticObject, capability: capability ?? tool.capabilities[0], adapterId: tool.id, kind: 'tool', payload: { deterministic: tool.deterministic ?? tool.executionMode === 'deterministic', ...payload } });
    } catch (error) {
      return createExecutionResult({ semantic: context.semanticObject, capability: capability ?? tool.capabilities[0], adapterId: tool.id, kind: 'tool', error });
    }
  }
  inputFor(step, context) { return resolveInputMapping(step.inputMapping, context); }
}
