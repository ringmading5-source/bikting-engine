import { setupHome } from './home/home.js';
import { readTextRequest } from './input/textInput.js';
import { renderGraph } from './workspace/renderGraph.js';
import { PlaybackController } from './workspace/playback.js';
import { presentResult, renderStep } from './output/presentResult.js';

const byId = (id) => document.getElementById(id);
const elements = { title: byId('workspace-title'), caption: byId('visual-caption'), explanation: byId('explanation'), count: byId('step-count'), play: byId('narrate-button'), previous: byId('previous-step'), next: byId('next-step'), progress: byId('progress-fill'), stage: byId('stage-label'), visual: byId('visualization'), sketch: byId('intent-sketch') };
let playback;
let testToken = '';
let latestRun = 0;
let activeProject = null;
let voicePreferences = { language: 'en-US', rate: 0.95 };
const home = setupHome({
  onOpen: () => playback?.stop(),
  onPreferences: (preferences) => { voicePreferences = preferences; },
  onNew: () => {
    latestRun++; activeProject = null; playback?.stop(); playback = null;
    byId('prompt').value = ''; byId('clear-sketch').click();
    byId('intent-checkpoint').hidden = true; byId('run-usage').textContent = '';
    renderGraph(elements.visual, null); elements.title.textContent = 'Your workspace is ready';
    elements.explanation.textContent = 'Enter a question or an idea to start.';
    elements.caption.textContent = ''; elements.count.textContent = '—'; elements.progress.style.width = '0%'; elements.stage.textContent = 'WAITING';
    elements.play.disabled = elements.next.disabled = elements.previous.disabled = true;
    renderTrace([]); byId('prompt').focus();
  },
  onResume: (project) => {
    latestRun++; activeProject = project.id; playback?.stop();
    byId('prompt').value = project.text; byId('intent-checkpoint').hidden = true;
    elements.sketch.restore?.(project.sketch, project.sketchLayout);
    if (project.result) displayResult(project.result);
    else { renderGraph(elements.visual, null); elements.stage.textContent = 'DRAFT'; elements.explanation.textContent = 'Draft restored. Run request to review its intent.'; elements.play.disabled = elements.next.disabled = elements.previous.disabled = true; }
    byId('prompt').focus();
  }
});

setupSketch(elements.sketch, byId('clear-sketch'), byId('concept-image'), byId('puzzle-pieces'));
setupVoice(byId('voice-input'), byId('prompt'));
readTextRequest(byId('request-form'), byId('prompt'), (request) => runPipeline(request), elements.sketch);

async function runPipeline(request) {
  const run = ++latestRun;
  const projectId = home.record(request, null, activeProject ?? undefined);
  activeProject = projectId;
  let completed = false;
  const checkpoint = byId('intent-checkpoint');
  checkpoint.hidden = true;
  byId('run-usage').textContent = '';
  const stages = ['ZOOMING INTO INTENT', 'FILLING RELATIONSHIPS', 'WRITING BUILD DIRECTIONS', 'EXECUTING TOOL'];
  let stageIndex = 0;
  const stageTimer = setInterval(() => { if (!completed && run === latestRun) elements.stage.textContent = stages[Math.min(stageIndex++, stages.length - 1)]; }, 700);
  try {
    let intentResponse = await sendRequest(request, '/api/intent');
    if (intentResponse.status === 401) {
      testToken = window.prompt('Enter your Bikting test access token:') ?? '';
      if (!testToken) return;
      intentResponse = await sendRequest(request, '/api/intent');
    }
    if (!intentResponse.ok) throw new Error(`Intent preview failed (${intentResponse.status})`);
    const intent = await intentResponse.json();
    if (run !== latestRun) return;
    if (intent.scene) {
      playback?.stop();
      renderGraph(elements.visual, intent.scene, 0);
      elements.title.textContent = intent.task ? 'Build intent sketch' : 'Relationship intent sketch';
      elements.explanation.textContent = intent.task ? `Intent: ${intent.task.action} ${intent.task.target}. Building from ${intent.relationships.map(({ from, relation, to }) => `${from} ${relation.replaceAll('_', ' ')} ${to}`).join(', ')}.` : `The engine found ${intent.relationships.length} relationships and is preparing the visual or build tool.`;
    }
    byId('intent-summary').textContent = intent.task ? `${intent.task.action} ${intent.task.target} — ${request.text}` : request.text;
    byId('intent-relationships').textContent = intent.relationships.length ? `Relationships: ${intent.relationships.map(({ from, relation, to }) => `${from} → ${relation.replaceAll('_', ' ')} → ${to}`).join('; ')}` : 'No explicit relationships found yet.';
    byId('intent-limitations').textContent = 'This is a preliminary sketch; edit your request if it does not match your goal. The final execution can still require more information or a connected provider.';
    checkpoint.hidden = false;
    elements.stage.textContent = 'CHECK INTENT';
    completed = true;
    clearInterval(stageTimer);
    const confirmed = await new Promise((resolve) => {
      byId('confirm-intent').onclick = () => { checkpoint.hidden = true; resolve(true); };
      byId('edit-intent').onclick = () => { checkpoint.hidden = true; byId('prompt').focus(); resolve(false); };
    });
    if (!confirmed || run !== latestRun) return;
    if (byId('prompt').value.trim() !== request.text) {
      elements.stage.textContent = 'REVIEW REVISED INTENT';
      elements.explanation.textContent = 'Your request changed after this preview. Run request again to review the new intent.';
      byId('prompt').focus();
      return;
    }
    elements.stage.textContent = 'EXECUTING TOOL';
  } catch (error) {
    if (run === latestRun) { elements.stage.textContent = 'ERROR'; elements.explanation.textContent = `Intent preview unavailable: ${error.message}`; }
    return;
  } finally { clearInterval(stageTimer); }
  let result;
  try {
    let response = await sendRequest(request);
    if (response.status === 401) {
      testToken = window.prompt('Enter your Bikting test access token:') ?? '';
      if (!testToken) return;
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
  home.record(request, result, projectId);
  displayResult(result);
}

function displayResult(result) {
  renderTrace(result.trace);
  const usage = result.usage;
  if (usage) byId('run-usage').textContent = `${usage.modelCalls} model call${usage.modelCalls === 1 ? '' : 's'} · ${usage.inputTokens + usage.outputTokens} reported tokens · ${usage.deterministicToolCalls} deterministic tool call${usage.deterministicToolCalls === 1 ? '' : 's'}${usage.cacheHit ? ' · cache hit' : ''}. Exact cost unavailable.`;
  elements.stage.textContent = result.workspace.status.toUpperCase();
  renderGraph(elements.visual, result.workspace.scene, 0);
  playback?.stop();
  playback = new PlaybackController({ result, preferences: voicePreferences, onStep: (index, step, state) => {
    renderStep(step, index, result.workspace.steps.length, state, elements);
    renderGraph(elements.visual, result.workspace.scene, typeof step.visualState === 'number' ? step.visualState : index);
    elements.stage.textContent = result.workspace.status.toUpperCase();
  } });
  presentResult(result, elements, { onStep: (direction) => direction === 'next' ? playback.next() : playback.previous(), onPlay: () => playback.play() });
  if (result.workspace.buildPlan?.length) elements.caption.textContent = `Build plan: ${result.workspace.buildPlan.join(' ')}`;
  if (result.workspace.nextAction) elements.explanation.innerHTML += `<p class="connection-action">${escapeHtml(result.workspace.nextAction)}</p>`;
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
  const context = canvas.getContext?.('2d');
  if (!context) { canvas.setAttribute('aria-hidden', 'true'); return; }
  context.strokeStyle = '#c3f36b'; context.lineWidth = 3; context.lineCap = 'round';
  let order = []; let image = null;
  const draw = () => { context.clearRect(0, 0, canvas.width, canvas.height); if (image) { const cols = 3; const rows = 3; const tileW = canvas.width / cols; const tileH = canvas.height / rows; (order.length ? order : Array.from({ length: 9 }, (_, i) => i)).forEach((source, slot) => { const sx = source % cols * image.width / cols; const sy = Math.floor(source / cols) * image.height / rows; context.drawImage(image, sx, sy, image.width / cols, image.height / rows, slot % cols * tileW, Math.floor(slot / rows) * tileH, tileW, tileH); }); } };
  const renderPieces = () => { if (!pieces || !image) return; pieces.innerHTML = ''; const cols = 3; const rows = 3; if (!order.length) order = Array.from({ length: 9 }, (_, i) => i); order.forEach((source, slot) => { const tile = document.createElement('canvas'); tile.width = 120; tile.height = 70; tile.draggable = true; tile.className = 'puzzle-piece'; const tc = tile.getContext('2d'); const sx = source % cols * image.width / cols; const sy = Math.floor(source / cols) * image.height / rows; tc.drawImage(image, sx, sy, image.width / cols, image.height / rows, 0, 0, tile.width, tile.height); tile.title = `Piece ${source + 1}; drag to reorder`; tile.addEventListener('dragstart', (event) => event.dataTransfer.setData('text/plain', String(slot))); tile.addEventListener('dragover', (event) => event.preventDefault()); tile.addEventListener('drop', (event) => { event.preventDefault(); const from = Number(event.dataTransfer.getData('text/plain')); [order[from], order[slot]] = [order[slot], order[from]]; renderPieces(); draw(); }); pieces.appendChild(tile); }); };
  upload?.addEventListener('change', () => { const file = upload.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { image = new Image(); image.onload = () => { order = []; draw(); renderPieces(); }; image.src = reader.result; }; reader.readAsDataURL(file); });
  clear?.addEventListener('click', () => { image = null; order = []; context.clearRect(0, 0, canvas.width, canvas.height); if (pieces) pieces.innerHTML = ''; if (upload) upload.value = ''; });
  canvas.restore = (data, layout) => {
    clear.click();
    if (!data) return;
    const restored = new Image();
    restored.onload = () => { image = restored; order = layout?.pieces?.length === 9 ? [...layout.pieces] : []; draw(); renderPieces(); };
    restored.src = data;
  };
  canvas.layout = () => image ? { type: 'image-puzzle', pieces: [...order], columns: 3, rows: 3 } : null;
}

function setupVoice(button, field) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!button || !Recognition) { if (button) button.disabled = true; return; }
  const recognition = new Recognition(); recognition.lang = voicePreferences.language; recognition.interimResults = false;
  button.addEventListener('click', () => { if (button.classList.contains('listening')) return; button.classList.add('listening'); button.textContent = '● Listening'; try { recognition.lang = voicePreferences.language; recognition.start(); } catch { recognition.onend(); } });
  recognition.onresult = (event) => { field.value = event.results[0][0].transcript; };
  recognition.onend = () => { button.classList.remove('listening'); button.textContent = '● Speak'; };
  recognition.onerror = () => recognition.onend();
}

function renderTrace(trace = []) {
  byId('trace-status').textContent = `${trace.length} runtime stages complete`;
  byId('trace').innerHTML = trace.map((entry, index) => `<div class="trace-row done"><span>${String(index + 1).padStart(2, '0')}</span><b>${escapeHtml(entry.section)}</b><span>${escapeHtml(entry.detail)}</span></div>`).join('');
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
