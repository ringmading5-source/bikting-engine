import { readTextRequest } from './input/textInput.js';
import { renderGraph } from './workspace/renderGraph.js';
import { PlaybackController } from './workspace/playback.js';
import { presentResult, renderStep } from './output/presentResult.js';

const byId = (id) => document.getElementById(id);
const elements = { title: byId('workspace-title'), caption: byId('visual-caption'), explanation: byId('explanation'), count: byId('step-count'), play: byId('narrate-button'), previous: byId('previous-step'), next: byId('next-step'), progress: byId('progress-fill'), stage: byId('stage-label'), visual: byId('visualization'), sketch: byId('intent-sketch') };
let playback;
let testToken = '';
let latestRun = 0;

setupSketch(elements.sketch, byId('clear-sketch'));
readTextRequest(byId('request-form'), byId('prompt'), (request) => runPipeline(request), elements.sketch);

async function runPipeline(request) {
  const run = ++latestRun;
  let completed = false;
  const stages = ['ZOOMING INTO INTENT', 'FILLING RELATIONSHIPS', 'WRITING BUILD DIRECTIONS', 'EXECUTING TOOL'];
  let stageIndex = 0;
  const stageTimer = setInterval(() => { if (!completed && run === latestRun) elements.stage.textContent = stages[Math.min(stageIndex++, stages.length - 1)]; }, 700);
  const showIntent = async () => {
    try {
      const response = await sendRequest(request, '/api/intent');
      if (!response.ok) return;
      const intent = await response.json();
      if (run !== latestRun || completed || !intent.scene) return;
      playback?.stop();
      renderGraph(elements.visual, intent.scene, 0);
      elements.title.textContent = 'Website build sketch';
      elements.explanation.textContent = `Intent: ${intent.task.action} ${intent.task.target}. Building from ${intent.relationships.map(({ from, relation, to }) => `${from} ${relation.replaceAll('_', ' ')} ${to}`).join(', ')}.`;
      elements.stage.textContent = 'GENERATING';
    } catch { /* The primary request still supplies the final result. */ }
  };
  void showIntent();
  let result;
  try {
    let response = await sendRequest(request);
    if (response.status === 401) {
      testToken = window.prompt('Enter your Bikting test access token:') ?? '';
      if (!testToken) return;
      void showIntent();
      response = await sendRequest(request);
    }
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Unexpected server response');
    result = await response.json();
  } catch {
    if (run !== latestRun) return;
    elements.stage.textContent = 'ERROR';
    elements.explanation.textContent = 'The server did not respond. Please try again.';
    return;
  }
  if (run !== latestRun) return;
  completed = true;
  clearInterval(stageTimer);
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
  if (result.workspace.visualTool) {
    const { selected, recommended } = result.workspace.visualTool;
    const rendererName = selected.id === 'plotly' && !window.Plotly ? 'Bikting SVG Plot (fallback)' : selected.name;
    elements.caption.textContent = `Rendered with ${rendererName}.${recommended ? ` ${recommended.name} requires ${recommended.requirement}.` : ''}`;
  }
  if (!('speechSynthesis' in window) && !result.workspace.scene?.states?.length) elements.play.disabled = true;
  playback.show(0);
}

function sendRequest(request, path = '/api/run') {
  const body = typeof request === 'string' ? { text: request } : { text: request.text, sketch: request.sketch };
  return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(testToken ? { 'x-bikting-test-token': testToken } : {}) }, body: JSON.stringify(body) });
}

function setupSketch(canvas, clear) {
  if (!canvas) return;
  const context = canvas.getContext('2d'); context.strokeStyle = '#c3f36b'; context.lineWidth = 3; context.lineCap = 'round';
  let drawing = false;
  const point = (event) => { const rect = canvas.getBoundingClientRect(); return [(event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height]; };
  canvas.addEventListener('pointerdown', (event) => { drawing = true; canvas.setPointerCapture(event.pointerId); const [x, y] = point(event); context.beginPath(); context.moveTo(x, y); });
  canvas.addEventListener('pointermove', (event) => { if (!drawing) return; const [x, y] = point(event); context.lineTo(x, y); context.stroke(); });
  canvas.addEventListener('pointerup', () => { drawing = false; });
  clear?.addEventListener('click', () => context.clearRect(0, 0, canvas.width, canvas.height));
}

function renderTrace(trace = []) {
  byId('trace-status').textContent = `${trace.length} runtime stages complete`;
  byId('trace').innerHTML = trace.map((entry, index) => `<div class="trace-row done"><span>${String(index + 1).padStart(2, '0')}</span><b>${escapeHtml(entry.section)}</b><span>${escapeHtml(entry.detail)}</span></div>`).join('');
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
