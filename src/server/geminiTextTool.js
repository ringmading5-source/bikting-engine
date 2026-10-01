import { createTextMemory } from './textMemory.js';

/** Bounded text worker for actions with supplied material. */
export function createGeminiTextTool({ apiKey, model, fetchImpl = fetch, onModelCall = () => null, knowledgeStore = null, onMemoryHit = () => {} }) {
  if (!apiKey || !/^[a-zA-Z0-9._-]+$/.test(model)) throw new TypeError('A Gemini key and valid model are required.');
  const memory = createTextMemory({ knowledgeStore, onMemoryHit });
  return { id: 'gemini.bounded-text', name: 'Gemini bounded text worker', domain: 'language', deterministic: false,
    capabilities: ['text.summarize', 'text.compare'].map((id) => ({ id, operation: id.split('.')[1], executionMode: 'generative', acceptedInputs: ['semantic_object'], producedOutputs: ['text'] })),
    inputRequirements: ['semantic_object'],
    async execute({ semantic }) {
      const task = semantic.context?.task;
      if (!['summarize', 'compare'].includes(task?.action) || !task.input || task.input.length > 2000) return { status: 'blocked', reason: 'Supply bounded text for this action.' };
      const instruction = task.action === 'summarize'
        ? 'Summarize only the supplied material concisely. Preserve important qualifications. Do not add facts.'
        : 'Compare only the named items using criteria present in the input. State when information is missing; do not invent facts.';
      const body = JSON.stringify({ systemInstruction: { parts: [{ text: instruction }] }, contents: [{ role: 'user', parts: [{ text: task.input }] }], generationConfig: { maxOutputTokens: 450 } });
      return memory.resolve({ model, body, language: semantic.language ?? 'und' }, async () => {
      const started = Date.now();
      const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body });
      if (!response.ok) { onModelCall({ taskId: `text:${task.action}`, model, inputTokensEstimated: Math.ceil(body.length / 3), outputTokens: 0, latencyMs: Date.now() - started, status: 'failed' }); throw new Error(`Text worker failed (${response.status}).`); }
      const payload = await response.json();
      const output = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();

      const inputTokens = payload.usageMetadata?.promptTokenCount ?? Math.ceil(body.length / 3);
      const outputTokens = (payload.usageMetadata?.candidatesTokenCount ?? 0) + (payload.usageMetadata?.thoughtsTokenCount ?? 0);
      const estimatedCostUsd = onModelCall({ taskId: `text:${task.action}`, model, inputTokensActual: inputTokens, outputTokens, latencyMs: Date.now() - started, status: 'passed' });
      if (!output) throw new Error('Text worker returned no text.');
      return { type: 'text_result', text: output, provenance: { source: 'gemini', model, validation: 'nonempty_text', factualVerification: false }, modelUsage: { calls: 1, inputTokens, outputTokens, estimatedCostUsd } };
      });
    },
  };
}
