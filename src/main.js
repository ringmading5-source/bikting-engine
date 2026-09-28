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
setupVoice(byId('voice-input'), byId('prompt'));
readTextRequest(byId('request-form'), byId('prompt'), (request) => runPipeline(request), elements.sketch);

async function runPipeline(request) {
  const run = ++latestRun;
  let completed = false;
  const stages = ['ZOOMING INTO INTENT', 'FILLING RELATIONSHIPS', 'WRITING BUILD DIRECTIONS', 'EXECUTING TOOL'];
  let stageIndex = 0;
  const sta…743 tokens truncated…ed.id === 'plotly' && !window.Plotly ? 'Bikting SVG Plot (fallback)' : selected.name;
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
  const context = canvas.getContext?.('2d');
  if (!context) { canvas.setAttribute('aria-hidden', 'true'); return; }
  context.strokeStyle = '#c3f36b'; context.lineWidth = 3; context.lineCap = 'round';
  let order = []; let image = null;
  const draw = () => { context.clearRect(0, 0, canvas.width, canvas.height); if (image) { const cols = 3; const rows = 3; const tileW = canvas.width / cols; const tileH = canvas.height / rows; (order.length ? order : Array.from({ length: 9 }, (_, i) => i)).forEach((source, slot) => { const sx = source % cols * image.width / cols; const sy = Math.floor(source / cols) * image.height / rows; context.drawImage(image, sx, sy, image.width / cols, image.height / rows, slot % cols * tileW, Math.floor(slot / rows) * tileH, tileW, tileH); }); } };
  const renderPieces = () => { if (!pieces || !image) return; pieces.innerHTML = ''; const cols = 3; const rows = 3; if (!order.length) order = Array.from({ length: 9 }, (_, i) => i); order.forEach((source, slot) => { const tile = document.createElement('canvas'); tile.width = 120; tile.height = 70; tile.draggable = true; tile.className = 'puzzle-piece'; const tc = tile.getContext('2d'); const sx = source % cols * image.width / cols; const sy = Math.floor(source / cols) * image.height / rows; tc.drawImage(image, sx, sy, image.width / cols, image.height / rows, 0, 0, tile.width, tile.height); tile.title = `Piece ${source + 1}; drag to reorder`; tile.addEventListener('dragstart', (event) => event.dataTransfer.setData('text/plain', String(slot))); tile.addEventListener('dragover', (event) => event.preventDefault()); tile.addEventListener('drop', (event) => { event.preventDefault(); const from = Number(event.dataTransfer.getData('text/plain')); [order[from], order[slot]] = [order[slot], order[from]]; renderPieces(); draw(); }); pieces.appendChild(tile); }); };
  upload?.addEventListener('change', () => { const file = upload.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { image = new Image(); image.onload = () => { order = []; draw(); renderPieces(); }; image.src = reader.result; }; reader.readAsDataURL(file); });
  clear?.addEventListener('click', () => { image = null; order = []; context.clearRect(0, 0, canvas.width, canvas.height); if (pieces) pieces.innerHTML = ''; if (upload) upload.value = ''; });
  canvas.layout = () => image ? { type: 'image-puzzle', pieces: [...order], columns: 3, rows: 3 } : null;
}

function setupVoice(button, field) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!button || !Recognition) { if (button) button.disabled = true; return; }
  const recognition = new Recognition(); recognition.lang = 'en-US'; recognition.interimResults = false;
  button.addEventListener('click', () => { if (button.classList.contains('listening')) return; button.classList.add('listening'); button.textContent = '● Listening'; try { recognition.start(); } catch { recognition.onend(); } });
  recognition.onresult = (event) => { field.value = event.results[0][0].transcript; };
  recognition.onend = () => { button.classList.remove('listening'); button.textContent = '● Speak'; };
  recognition.onerror = () => recognition.onend();
}

function renderTrace(trace = []) {
  byId('trace-status').textContent = `${trace.length} runtime stages complete`;
  byId('trace').innerHTML = trace.map((entry, index) => `<div class="trace-row done"><span>${String(index + 1).padStart(2, '0')}</span><b>${escapeHtml(entry.section)}</b><span>${escapeHtml(entry.detail)}</span></div>`).join('');
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
