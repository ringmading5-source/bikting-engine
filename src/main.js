import { readTextRequest } from './input/textInput.js';
import { createBiktingRuntime } from './runtime/BiktingRuntime.js';
import { renderGraph } from './workspace/renderGraph.js';
import { PlaybackController } from './workspace/playback.js';
import { presentResult, renderStep } from './output/presentResult.js';

const byId = (id) => document.getElementById(id);
const elements = { title: byId('workspace-title'), caption: byId('visual-caption'), explanation: byId('explanation'), count: byId('step-count'), play: byId('narrate-button'), previous: byId('previous-step'), next: byId('next-step'), progress: byId('progress-fill'), stage: byId('stage-label'), visual: byId('visualization') };
const runtime = createBiktingRuntime();
let playback;

readTextRequest(byId('request-form'), byId('prompt'), (request) => runPipeline(request));

async function runPipeline(request) {
  const preview = byId('engine-preview');
  preview.textContent = 'Interpreting and planning…';
  const previewPromise = fetch('/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: request.text, mode: byId('live-model').checked ? 'live' : 'demo' }) })
    .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error); return body; })
    .then((data) => { preview.innerHTML = renderPreview(data); })
    .catch((error) => { preview.textContent = `Canonical preview unavailable: ${error.message}`; });
  const result = await runtime.run(request);
  renderTrace(result.trace);
  elements.stage.textContent = result.workspace.status.toUpperCase();
  renderGraph(elements.visual, result.workspace.scene, 0);
  playback?.stop();
  playback = new PlaybackController({ result, onStep: (index, step, state) => {
    renderStep(step, index, result.workspace.steps.length, state, elements);
    renderGraph(elements.visual, result.workspace.scene, index);
    elements.stage.textContent = result.workspace.status.toUpperCase();
  } });
  presentResult(result, elements, { onStep: (direction) => direction === 'next' ? playback.next() : playback.previous(), onPlay: () => playback.play() });
  playback.show(0);
  await previewPromise;
}

function renderPreview(data) {
  const intent = data.interpretation;
  const steps = data.planning.steps.map((step) => `<li>${escapeHtml(step.capabilityId)} — ${escapeHtml(step.status)}</li>`).join('');
  const needs = data.knowledge.needs.map((need) => escapeHtml(need.topic)).join(', ');
  return `<p><b>Provider:</b> ${data.mode === 'live_model' ? 'configured live model' : 'deterministic demo'}</p><p><b>Interpretation:</b> ${escapeHtml(intent.objective)} (${escapeHtml(intent.intentType)})</p>`
    + `<p><b>Knowledge needed:</b> ${needs || 'none declared'}${data.knowledge.unresolvedTopics.length ? ' · evidence unavailable' : ''}</p>`
    + `<p><b>Plan:</b> ${escapeHtml(data.planning.status)}${data.planning.refusal ? ` · ${escapeHtml(data.planning.refusal)}` : ''}</p>`
    + (steps ? `<ol>${steps}</ol>` : '')
    + `<p><b>Execution:</b> not started${intent.issues.length ? ` · ${intent.issues.map((issue) => escapeHtml(issue.message)).join('; ')}` : ''}</p>`;
}

function renderTrace(trace = []) {
  byId('trace-status').textContent = `${trace.length} runtime stages complete`;
  byId('trace').innerHTML = trace.map((entry, index) => `<div class="trace-row done"><span>${String(index + 1).padStart(2, '0')}</span><b>${escapeHtml(entry.section)}</b><span>${escapeHtml(entry.detail)}</span></div>`).join('');
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
