export function summarizePilot(rows) {
  const byTask = {};
  for (const row of rows) {
    const group = byTask[row.taskType] ??= { runs: 0, successful: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, cacheHits: 0, feedbackCount: 0, userCompleted: 0, ratingTotal: 0, friction: {} };
    group.runs++;
    if (row.validated) group.successful++;
    group.modelCalls += row.modelCalls;
    group.inputTokens += row.inputTokens;
    group.outputTokens += row.outputTokens;
    group.estimatedCostUsd += row.estimatedCostUsd ?? 0;
    if (row.cacheHit) group.cacheHits++;
    if (row.rating != null) { group.feedbackCount++; group.ratingTotal += row.rating; if (row.completedByUser) group.userCompleted++; }
    if (row.friction) group.friction[row.friction] = (group.friction[row.friction] ?? 0) + 1;
  }
  for (const group of Object.values(byTask)) {
    group.validationRate = group.runs ? group.successful / group.runs : 0;
    group.userCompletionRate = group.feedbackCount ? group.userCompleted / group.feedbackCount : null;
    group.averageRating = group.feedbackCount ? group.ratingTotal / group.feedbackCount : null;
    delete group.ratingTotal;
  }
  return { totalRuns: rows.length, byTask };
}

export function pilotRecord(result, elapsedMs) {
  return { id: randomUUID(), taskType: result.semantic?.context?.task?.capability === 'website.build' ? 'website' :
    ['calculate', 'convert_units', 'vector_calculate', 'plot'].includes(result.semantic?.intent) ? 'deterministic' : 'explanation',
    status: result.status, modelCalls: result.usage?.modelCalls ?? 0, inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0, estimatedCostUsd: result.usage?.estimatedCostUsd ?? null,
    deterministicCalls: result.usage?.deterministicToolCalls ?? 0, cacheHit: Boolean(result.usage?.cacheHit),
    validated: result.status === 'completed' && !result.outputs?.errors?.length && Boolean(result.execution?.length) &&
      result.execution.every(item => item.metadata?.kind === 'engine' || item.verification?.status === 'verified'),
    elapsedMs, createdAt: new Date().toISOString(), rating: null, completedByUser: null, friction: null };
}
import { randomUUID } from 'node:crypto';
