import { readTextRequest } from './input/textInput.js';
import { renderGraph } from './workspace/renderGraph.js';
import { PlaybackController } from './workspace/playback.js';
import { presentResult, renderStep } from './output/presentResult.js';

const byId = (id) => document.getElementById(id);
const elements = { title: byId('workspace-title'), caption: byId('visual-caption'), explanation: byId('explanation'), count: byId('step-count'), play: byId('narrate-button'), previous: byId('previous-step'), next: byId('next-step'), progress: byId('progress-fill'), stage: byId('stage-label'), visual: byId('visualization') };
let playback;
let testToken = '';

readTextRequest(byId('request-form'), byId('prompt'), (request) => runPipeline(request));

async function runPipeline(request) {
  let result;
  try {
    let response = await sendRequest(request.text);
    if (response.status === 401) {
      testToken = window.prompt('Enter your Bikting test access token:') ?? '';
      if (!testToken) return;
      response = await sendRequest(request.text);
    }
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Unexpected server response');
    result = await response.json();
  } catch {
    elements.stage.textContent = 'ERROR';
    elements.explanation.textContent = 'The server did not respond. Please try again.';
    return;
  }
  renderTrace(result.trace);
  elements.stage.textContent = result.workspace.status.toUpperCase();
  renderGraph(elements.visual, result.workspace.scene, 0);
  playback?.stop();
  playback = new PlaybackController({ result, onStep: (index, step, state) => {
    renderStep(step, index, result.workspace.steps.length, state, elements);
    renderGraph(elements.visual, result.workspace.scene, typeof step.visualState === 'number' ? step.visualState : index);
    elements.stage.textContent = result.workspace.status.toUpperCase();
  } });
  presentResult(result, elements, { onStep: (direction) => direction === 'next' ? playback.next() : playback.previous(), onPlay: () => playback.play() });
  playback.show(0);
}

function sendRequest(text) {
  return fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(testToken ? { 'x-bikting-test-token': testToken } : {}) }, body: JSON.stringify({ text }) });
}

function renderTrace(trace = []) {
  byId('trace-status').textContent = `${trace.length} runtime stages complete`;
  byId('trace').innerHTML = trace.map((entry, index) => `<div class="trace-row done"><span>${String(index + 1).padStart(2, '0')}</span><b>${escapeHtml(entry.section)}</b><span>${escapeHtml(entry.detail)}</span></div>`).join('');
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
