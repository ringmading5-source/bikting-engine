/** Normalize adapter output while retaining source links back to its semantic object. */
export function createExecutionResult({ semantic, capability, adapterId, kind, payload = {}, error }) {
  const result = {
    ...payload,
    id: `result-${semantic.id}-${String(capability).replaceAll('.', '-')}-${adapterId}`,
    status: error ? 'error' : payload.status ?? 'completed',
    semanticId: semantic.id,
    relatedEntities: [...new Set(semantic.entities.map(({ id }) => id))],
    relationships: semantic.relationships.map(({ from, relation, to }) => ({ from, relation, to })),
    numericData: payload.numericData ?? payload.numericResult,
    equations: payload.equations ?? (payload.equation ? [payload.equation] : undefined),
    structuredVisualScenes: payload.structuredVisualScenes ?? payload.scene ?? (payload.type === 'visual_scene' ? payload : undefined),
    audioReferences: payload.audioReferences ?? payload.audio,
    images: payload.images ?? payload.image,
    toolResults: kind === 'tool' ? payload : undefined,
    errors: error ? [{ message: error.message }] : payload.errors,
    metadata: { capability, adapterId, kind, ...(payload.metadata ?? {}) },
    source: payload.source ?? { type: kind === 'tool' ? 'tool' : kind === 'model' ? 'model' : 'orchestrator', id: adapterId, deterministic: payload.deterministic ?? kind === 'tool' },
    provenance: [...semantic.provenance, { source: adapterId, method: kind, detail: capability }],
    confidence: payload.confidence ?? semantic.confidence,
  };
  if (error) result.error = error.message;
  return result;
}
