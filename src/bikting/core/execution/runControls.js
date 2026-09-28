/** Explicit capability gates. The server never infers approval from a prompt. */
export const approvalCapabilities = new Set(['website.deploy', 'artifact.publish', 'files.delete', 'payment.charge', 'account.connect']);

export function approvalFor(step, request) {
  if (!approvalCapabilities.has(step.capability)) return null;
  const approved = Array.isArray(request.approvedCapabilities) && request.approvedCapabilities.includes(step.capability);
  return approved ? null : { capability: step.capability, reason: `Approve ${step.capability} before it can run.`, status: 'approval_required' };
}

/** Verify observable evidence, not just the provider's assertion that it ran. */
export function verifyResult(step, result) {
  if (result.status !== 'completed') return { status: 'not_verified', reason: `Execution status: ${result.status}` };
  const capability = step.capability;
  if (capability === 'website.build') {
    const html = result.html;
    return typeof html === 'string' && /<!doctype html>/i.test(html) && /<\/html>\s*$/i.test(html) && result.structuredVisualScenes?.html === html
      ? { status: 'verified', evidence: 'Complete HTML and matching preview' }
      : { status: 'failed', reason: 'Website output has no complete matching HTML preview.' };
  }
  if (['math.calculate', 'physics.calculate_force', 'vector.calculate', 'units.convert'].includes(capability)) {
    const value = result.numericResult ?? result.numericData;
    return (typeof value === 'number' && Number.isFinite(value)) || (Array.isArray(value) && value.length > 0)
      ? { status: 'verified', evidence: 'Finite numeric result or nonempty data series' }
      : { status: 'unverified', reason: 'No checkable numeric output.' };
  }
  if (capability === 'visual.scene') return result.structuredVisualScenes?.type
    ? { status: 'verified', evidence: 'Structured visual scene' }
    : { status: 'failed', reason: 'Visual tool returned no structured scene.' };
  return { status: 'unverified', reason: 'No domain-specific result check registered.' };
}

export function summarizeUsage(semantic, execution, request = {}) {
  const gemini = semantic.context?.modelUsage ?? null;
  const cacheHit = Boolean(request.modelCacheHit);
  return {
    modelCalls: cacheHit ? 0 : gemini?.calls ?? 0,
    inputTokens: cacheHit ? 0 : gemini?.inputTokens ?? 0,
    outputTokens: cacheHit ? 0 : gemini?.outputTokens ?? 0,
    cacheHit,
    deterministicToolCalls: execution.filter((result) => result.metadata?.kind === 'tool' && result.source?.deterministic && result.status === 'completed').length,
    // Prices depend on model and billing plan; do not invent a dollar amount.
    estimatedCostUsd: cacheHit ? 0 : gemini?.estimatedCostUsd ?? null,
  };
}
