import { readTextRequest } from './input/textInput.js';
import { renderGraph } from './workspace/renderGraph.js';
import { PlaybackController } from './workspace/playback.js';
import { presentResult, renderStep } from './output/presentResult.js';

const byId = (id) => document.getElementById(id);
const elements = { title: byId('workspace-title'), caption: byId('visual-caption'), explanation: byId('explanation'), count: byId('step-count'), play: byId('narrate-button'), previous: byId('previous-step'), next: byId('next-step'), progress: byId('progress-fill'), stage: byId('stage-label'), visual: byId('visualization'), sketch: byId('intent-sketch') };
let playback;
let testToken = '';
let latestRun = 0;

setupSketch(elements.sketch, byId('clear-sketch'), byId('concept-image'), byId('puzzle-pieces'));
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
  const body = typeof request === 'string' ? { text: request } : { text: request.text, sketch: request.sketch, sketchLayout: request.sketchLayout };
  return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(testToken ? { 'x-bikting-test-token': testToken } : {}) }, body: JSON.stringify(body) });
}

function setupSketch(canvas, clear, upload, pieces) {
  if (!canvas) return;
  const context = canvas.getContext('2d'); context.strokeStyle = '#c3f36b'; context.lineWidth = 3; context.lineCap = 'round';
  let order = []; let image = null;
  const draw = () => { context.clearRect(0, 0, canvas.width, canvas.height); if (image) { const cols = 3; const rows = 3; const tileW = canvas.width / cols; const tileH = canvas.height / rows; (order.length ? order : Array.from({ length: 9 }, (_, i) => i)).forEach((source, slot) => { const sx = source % cols * image.width / cols; const sy = Math.floor(source / cols) * image.height / rows; context.drawImage(image, sx, sy, image.width / cols, image.height / rows, slot % cols * tileW, Math.floor(slot / rows) * tileH, tileW, tileH); }); } };
  const renderPieces = () => { if (!pieces || !image) return; pieces.innerHTML = ''; const cols = 3; const rows = 3; if (!order.length) order = Array.from({ length: 9 }, (_, i) => i); order.forEach((source, slot) => { const tile = document.createElement('canvas'); tile.width = 120; tile.height = 70; tile.draggable = true; tile.className = 'puzzle-piece'; const tc = tile.getContext('2d'); const sx = source % cols * image.width / cols; const sy = Math.floor(source / cols) * image.height / rows; tc.drawImage(image, sx, sy, image.width / cols, image.height / rows, 0, 0, tile.width, tile.height); tile.title = `Piece ${source + 1}; drag to reorder`; tile.addEventListener('dragstart', (event) => event.dataTransfer.setData('text/plain', String(slot))); tile.addEventListener('dragover', (event) => event.preventDefault()); tile.addEventListener('drop', (event) => { event.preventDefault(); const from = Number(event.dataTransfer.getData('text/plain')); [order[from], order[slot]] = [order[slot], order[from]]; renderPieces(); draw(); }); pieces.appendChild(tile); }); };
  upload?.addEventListener('change', () => { const file = upload.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { image = new Image(); image.onload = () => { order = []; draw(); renderPieces(); }; image.src = reader.result; }; reader.readAsDataURL(file); });
  clear?.addEventListener('click', () => { image = null; order = []; context.clearRect(0, 0, canvas.width, canvas.height); if (pieces) pieces.innerHTML = ''; if (upload) upload.value = ''; });
  canvas.layout = () => image ? { type: 'image-puzzle', pieces: [...order], columns: 3, rows: 3 } : null;
}

function renderTrace(trace = []) {
  byId('trace-status').textContent = `${trace.length} runtime stages complete`;
  byId('trace').innerHTML = trace.map((entry, index) => `<div class="trace-row done"><span>${String(index + 1).padStart(2, '0')}</span><b>${escapeHtml(entry.section)}</b><span>${escapeHtml(entry.detail)}</span></div>`).join('');
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
