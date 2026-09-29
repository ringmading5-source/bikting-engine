/**
 * Convert a canonical orchestration result into a renderer-friendly view model.
 * This is presentation-only: all content comes from semantic/execution outputs.
 */
import { createExecutionScene } from '../visualization/executionScene.js';
import { createConceptPieceScene } from '../visualization/conceptScene.js';

export function createWorkspaceProjection(result) {
  const outputs = result.outputs ?? {};
  const explanation = textFrom(outputs.explanation);
  const narration = Array.isArray(outputs.narration?.segments)
    ? outputs.narration.segments.map(normalizeNarrationSegment).filter((segment) => segment)
    : [];
  const errors = outputs.errors ?? [];
  const unexecuted = outputs.unexecuted ?? [];
  const conceptScene = createConceptPieceScene(result);
  const scene = conceptScene ?? outputs.visual?.structuredVisualScenes ?? outputs.structuredVisualScenes?.[0] ?? createExecutionScene(result);
  const teaching = result.plan?.procedure;
  const steps = teaching?.status === 'ready' ? teaching.stages.map((stage, index) => ({ title: stage.title, text: stage.text, narration: stage.text,
    visualState: scene?.states?.length ? Math.min(index, scene.states.length - 1) : undefined })) : teaching?.status === 'blocked'
    ? [{ title: 'Teaching needs context', text: teaching.reason }] : narration.length
    ? narration.map((segment, index) => ({
      title: `Narration ${String(index + 1).padStart(2, '0')}`,
      text: segment.text,
      narration: segment.text,
      visualState: typeof segment.visualState === 'number' ? segment.visualState : scene?.states?.length ? Math.min(index, scene.states.length - 1) : undefined,
    }))
    : fallbackSteps({ explanation, outputs, errors, unexecuted, scene });

  return {
    wordComposition: result.semantic?.context?.wordComposition ?? null,
    teachingExpansion: result.semantic?.context?.teachingExpansion ?? null,
    knowledge: result.semantic?.context?.knowledge ?? null,
    title: `${humanize(result.semantic?.intent ?? 'request')} request`,
    summary: summaryFor({ explanation, outputs, errors, unexecuted, result }),
    scene,
    visualTool: scene?.toolSelection ?? null,
    steps: steps.length ? steps : [{ title: 'Result', text: 'The request completed without a displayable output.' }],
    hasNarration: steps.some((step) => Boolean(step.narration || step.text)),
    status: result.status ?? 'unknown',
    confidence: result.semantic?.confidence ?? 0,
    errors,
    unexecuted,
    provenance: result.execution?.map((item) => item.provenance ?? item.source).filter(Boolean) ?? [],
    buildPlan: result.semantic?.context?.buildPlan ?? [],
    nextAction: result.outputs?.unexecuted?.find((item) => item.nextAction)?.nextAction ?? null,
  };
}

function fallbackSteps({ explanation, outputs, errors, unexecuted, scene }) {
  const steps = [];
  if (scene?.states?.length) steps.push(...scene.states.map((state, index) => ({ title: state.title ?? `Visual frame ${index + 1}`, text: state.text ?? `Showing ${state.pointCount} plotted points.`, visualState: index })));
  if (explanation) steps.push({ title: 'Explanation', text: explanation, visualState: scene?.states?.length ? scene.states.length - 1 : undefined });
  for (const error of errors) steps.push({ title: 'Execution error', text: error.message ?? String(error) });
  if (outputs.numericData?.length && scene?.source?.id !== 'execution-visualizer') steps.push({ title: 'Result', text: describeNumeric(outputs.numericData[0]) });
  if (scene && !steps.length) steps.push({ title: 'Visual result', text: 'Generated structured visual output.' });
  if (unexecuted.length) steps.push(...unexecuted.map((item) => ({ title: item.nextAction ? 'Action needs a connected provider' : 'Unexecuted work', text: item.nextAction ?? `No connected tool can execute ${item.metadata?.capability ?? item.requiredCapability ?? item.id}.` })));
  return steps;
}

function summaryFor({ explanation, outputs, errors, unexecuted, result }) {
  const detail = explanation
    ?? (errors.length ? errors[0].message ?? String(errors[0]) : null)
    ?? (outputs.numericData?.length ? describeNumeric(outputs.numericData[0]) : null)
    ?? (unexecuted.length ? 'Some requested work remains unexecuted.' : 'Structured execution result ready.');
  return `${detail} Status: ${result.status ?? 'unknown'}; confidence: ${Math.round((result.semantic?.confidence ?? 0) * 100)}%.`;
}

function describeNumeric(value) {
  if (typeof value === 'number') return `Result: ${value}.`;
  if (Array.isArray(value)) return `Produced ${value.length} numeric values.`;
  return 'Produced structured numeric data.';
}

function textFrom(output) {
  if (typeof output?.text === 'string') return output.text;
  if (typeof output?.message === 'string') return output.message;
  return null;
}

function normalizeNarrationSegment(segment) {
  if (typeof segment === 'string' && segment.trim()) return { text: segment };
  if (typeof segment?.text === 'string' && segment.text.trim()) return segment;
  return null;
}

function humanize(value) {
  return String(value).replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
