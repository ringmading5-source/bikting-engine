/** Explicit capability gates. The server never infers approval from a prompt. */
export const approvalCapabilities = new Set(['website.deploy', 'artifact.publish', 'files.delete', 'payment.charge', 'account.connect']);

export function approvalFor(step, request) {
  if (!approvalCapabilities.has(step.capability)) return null;
  if (step.capability === 'payment.charge') {
    const quote = step.quote;
    const validQuote = quote && typeof quote.id === 'string' && quote.id.length > 0 &&
      typeof quote.provider === 'string' && quote.provider.length > 0 &&
      typeof quote.item === 'string' && quote.item.length > 0 &&
      Number.isSafeInteger(quote.amountMinor) && quote.amountMinor > 0 &&
      typeof quote.currency === 'string' && /^[A-Z]{3}$/.test(quote.currency);
    const approval = request.purchaseApproval;
    const matches = validQuote && approval && approval.quoteId === quote.id &&
      approval.provider === quote.provider && approval.item === quote.item &&
      approval.amountMinor === quote.amountMinor && approval.currency === quote.currency;
    return matches ? null : { capability: step.capability, status: 'approval_required', quote: validQuote ? quote : null,
      reason: validQuote ? `Approve ${quote.item} from ${quote.provider} for ${quote.currency} ${(quote.amountMinor / 100).toFixed(2)} before purchase.` : 'A provider quote with an exact price is required before purchase.' };
  }
  const approved = Array.isArray(request.approvedCapabilities) && request.approvedCapabilities.includes(step.capability);
  return approved ? null : { capability: step.capability, reason: `Approve ${step.capability} before it can run.`, status: 'approval_required' };
}

/** Verify observable evidence, not just the provider's assertion that it ran. */
export function verifyResult(step, result) {
  if (result.status !== 'completed') return { status: 'not_verified', reason: `Execution status: ${result.status}` };
  const capability = step.capability;
  if (capability === 'website.build' || capability === 'website.edit') {
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
  if (['text.summarize', 'text.compare'].includes(capability)) return typeof result.text === 'string' && result.text.trim()
    ? { status: 'verified', evidence: 'Nonempty text output; factual quality requires separate review.' }
    : { status: 'failed', reason: 'Text worker returned no usable text.' };
  return { status: 'unverified', reason: 'No domain-specific result check registered.' };
}

export function summarizeUsage(semantic, execution, request = {}) {
  const gemini = semantic.context?.modelUsage ?? null;
  const worker = execution.map((result) => result.modelUsage).filter(Boolean);
  const interpretationHit = Boolean(request.modelCacheHit);
  const costs = [interpretationHit ? null : gemini, ...worker].filter((usage) => usage?.calls > 0).map((usage) => usage.estimatedCostUsd);
  const cacheHit = interpretationHit || worker.some(usage => usage.cacheHit);
  return {
    modelCalls: (interpretationHit ? 0 : (gemini?.calls ?? 0)) + worker.reduce((sum, usage) => sum + (usage.calls ?? 0), 0),
    inputTokens: (interpretationHit ? 0 : (gemini?.inputTokens ?? 0)) + worker.reduce((sum, usage) => sum + (usage.inputTokens ?? 0), 0),
    outputTokens: (interpretationHit ? 0 : (gemini?.outputTokens ?? 0)) + worker.reduce((sum, usage) => sum + (usage.outputTokens ?? 0), 0),
    cacheHit,
    deterministicToolCalls: execution.filter((result) => result.metadata?.kind === 'tool' && result.source?.deterministic && result.status === 'completed').length,
    // Prices depend on model and billing plan; do not invent a dollar amount.
    estimatedCostUsd: !costs.length ? (cacheHit ? 0 : null) : costs.length && costs.every((value) => value != null) ? costs.reduce((sum, value) => sum + value, 0) : null,
  };
}
