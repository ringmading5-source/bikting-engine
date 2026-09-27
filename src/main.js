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
}

function renderTrace(trace = []) {
  byId('trace-status').textContent = `${trace.length} runtime stages complete`;
  byId('trace').innerHTML = trace.map((entry, index) => `<div class="trace-row done"><span>${String(index + 1).padStart(2, '0')}</span><b>${escapeHtml(entry.section)}</b><span>${escapeHtml(entry.detail)}</span></div>`).join('');
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
