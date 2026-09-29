import { renderKnowledge } from './workspace/knowledgeSources.js';
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
let projectBaseText = '';
let voicePreferences = { language: 'en-US', rate: 0.95 };
const home = setupHome({
  onOpen: () => playback?.stop(),
  onPreferences: (preferences) => { voicePreferences = preferences; },
  onNew: () => {
    latestRun++; activeProject = null; projectBaseText = ''; byId('project-details').reset(); byId('project-details').hidden = true; byId('project-details-panel').hidden = true; byId('project-details-toggle').setAttribute('aria-expanded', 'false'); playback?.stop(); playback = null; renderKnowledge(byId('knowledge-sources'), null);
    byId('prompt').value = ''; byId('clear-sketch').click();
    byId('intent-checkpoint').hidden = true; byId('run-usage').textContent = '';
    byId('pilot-feedback').hidden = true;
    renderGraph(elements.visual, null); elements.title.textContent = 'Your workspace is ready';
    elements.explanation.textContent = 'Enter a question or an idea to start.';
    elements.caption.textContent = ''; elements.count.textContent = '—'; elements.progress.style.width = '0%'; elements.stage.textContent = 'WAITING';
    elements.play.disabled = elements.next.disabled = elements.previous.disabled = true;
    renderTrace([]); byId('prompt').focus();
  },
  onResume: (project) => {
    latestRun++; activeProject = project.id; projectBaseText = project.text; byId('project-details').reset(); byId('project-details').hidden = true; byId('project-details-panel').hidden = true; byId('project-details-toggle').setAttribute('aria-expanded', 'false'); playback?.stop();
    byId('prompt').value = project.text; byId('knowledge-mode').value = project.knowledgeMode ?? 'model'; byId('intent-checkpoint').hidden = true;
    elements.sketch.restore?.(project.sketch, project.sketchLayout);
    if (project.result) displayResult(project.result);
    else { renderGraph(elements.visual, null); elements.stage.textContent = 'DRAFT'; elements.explanation.textContent = 'Draft restored. Run request to review its intent.'; elements.play.disabled = elements.next.disabled = elements.previous.disabled = true; }
    byId('prompt').focus();
  }
});

setupSketch(elements.sketch, byId('clear-sketch'), byId('concept-image'), byId('puzzle-pieces'));
setupVoice(byId('voice-input'), byId('prompt'));
byId('pilot-feedback').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = byId('pilot-feedback-status');
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true; status.textContent = 'Saving feedback…';
  try {
    const response = await fetch('/api/pilot/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bikting-test-token': testToken },
      body: JSON.stringify({ runId: form.dataset.runId, rating: Number(form.elements.rating.value), completed: form.elements.completed.checked, friction: form.elements.friction.value || undefined }) });
    if (!response.ok) throw new Error(`Feedback could not be saved (${response.status}).`);
    status.textContent = 'Thanks. Your feedback was saved.';
  } catch (error) { status.textContent = error.message; button.disabled = false; }
});
readTextRequest(byId('request-form'), byId('prompt'), (request) => { projectBaseText = request.text; byId('project-details').reset(); runPipeline(request); }, elements.sketch);
byId('project-details-toggle').addEventListener('click', () => {
  const form = byId('project-details');
  form.hidden = !form.hidden;
  byId('project-details-toggle').setAttribute('aria-expanded', String(!form.hidden));
  if (!form.hidden) form.elements.namedItem('name').focus();
});
const textDrop = byId('project-text-drop');
textDrop.addEventListener('dragover', (event) => { if (!event.dataTransfer.types.includes('text/plain')) return; event.preventDefault(); textDrop.classList.add('drag-over'); });
textDrop.addEventListener('dragleave', () => textDrop.classList.remove('drag-over'));
textDrop.addEventListener('drop', (event) => {
  event.preventDefault(); textDrop.classList.remove('drag-over');
  const incoming = event.dataTransfer.getData('text/plain').trim();
  if (!incoming) return;
  const field = byId('project-details').elements.namedItem('additional');
  field.value = [field.value.trim(), incoming].filter(Boolean).join('\n').slice(0, field.maxLength);
  byId('project-details-status').textContent = 'Text added. Update the preview when ready.';
});
byId('project-details').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const fields = ['name', 'purpose', 'sections', 'content', 'style', 'additional'].map((name) => [name, form.elements.namedItem(name).value.trim()]).filter(([, value]) => value);
  if (!fields.length) { byId('project-details-status').textContent = 'Add at least one detail to update the preview.'; return; }
  const details = fields.map(([name, value]) => `${name}: ${value}`).join('\n');
  const text = `${projectBaseText.slice(0, 550)}\n\nUse these project details for the website preview:\n${details}`;
  if (text.length > 2000) { byId('project-details-status').textContent = 'Please shorten the details to fit this request.'; return; }
  byId('project-details-status').textContent = 'Updating preview…';
  form.hidden = true; byId('project-details-toggle').setAttribute('aria-expanded', 'false');
  runPipeline({ type: 'text', text, knowledgeMode: byId('knowledge-mode').value, sketch: null, sketchLayout: null });
});

async function runPipeline(request) {
  const run = ++latestRun;
  const projectId = home.record(request, null, activeProject ?? undefined);
  activeProject = projectId;
  let completed = false;
  const checkpoint = byId('intent-checkpoint');
  checkpoint.hidden = true;
  byId('run-usage').textContent = '';
  byId('pilot-feedback').hidden = true;
  playback?.stop();
  byId('project-details-panel').hidden = true;
  renderGraph(elements.visual, null);
  renderKnowledge(byId('knowledge-sources'), null);
  elements.stage.textContent = 'UNDERSTANDING REQUEST';
  const stageTimer = null;
  try {
    let intentResponse = await sendRequest(request, '/api/intent');
    if (intentResponse.status === 401) {
      testToken = window.prompt('Enter your Bikting test access token:') ?? '';
      if (!testToken) return;
      intentResponse = await sendRequest(request, '/api/intent');
    }
    const intent = await intentResponse.json().catch(() => ({}));
    if (!intentResponse.ok) throw new Error(intent.error || `Intent preview failed (${intentResponse.status})`);
    if (run !== latestRun) return;
    renderKnowledge(byId('knowledge-sources'), intent.knowledge);
    byId('intent-choices').replaceChildren();
    byId('confirm-intent').hidden = intent.status === 'clarification';
    if (intent.status === 'clarification') {
      checkpoint.hidden = false;
      elements.stage.textContent = 'CLARIFY REQUEST';
      elements.explanation.textContent = intent.question;
      byId('intent-summary').textContent = intent.question;
      byId('intent-relationships').textContent = '';
      byId('intent-limitations').textContent = 'Choose a meaning or edit your question.';
      for (const choice of intent.choices || []) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = choice;
        button.onclick = () => { byId('prompt').value = choice; runPipeline({ ...request, text: choice }); };
        byId('intent-choices').append(button);
      }
      byId('edit-intent').onclick = () => { checkpoint.hidden = true; byId('prompt').focus(); };
      return;
    }
    // A clear goal runs without exposing the planner. Clarification is shown above.
    elements.stage.textContent = 'WORKING';
    elements.explanation.textContent = 'Working on your request…';
  } catch (error) {
    if (run === latestRun) { elements.stage.textContent = 'ERROR'; elements.explanation.textContent = `Intent preview unavailable: ${error.message}`; }
    return;
  } finally { clearInterval(stageTimer); }
  let result;
  try {
    result = await sendStreamRequest(request, (event, data) => {
      if (event === 'stage') elements.stage.textContent = String(data.stage ?? 'working').toUpperCase();
      if (event === 'error') elements.explanation.textContent = data.message;
    });
  } catch (error) {
    if (run !== latestRun) return;
    elements.stage.textContent = 'ERROR';
    elements.explanation.textContent = error instanceof Error ? error.message : 'The server did not respond. Please try again.';
    return;
  }
  if (run !== latestRun) return;
  completed = true;
  clearInterval(stageTimer);
  home.record(request, result, projectId);
  displayResult(result);
}

function displayResult(result) {
  const details = byId('project-details-panel');
  details.hidden = result.workspace?.scene?.type !== 'website';
  byId('project-details-status').textContent = '';
  const feedback = byId('pilot-feedback');
  feedback.hidden = !result.pilotRunId;
  if (result.pilotRunId) { feedback.reset(); feedback.dataset.runId = result.pilotRunId; feedback.querySelector('button[type="submit"]').disabled = false; byId('pilot-feedback-status').textContent = ''; }
  renderKnowledge(byId('knowledge-sources'), result.workspace.knowledge);
  renderTrace(result.trace);
  const usage = result.usage;
  if (usage) byId('run-usage').textContent = `${usage.modelCalls} model call${usage.modelCalls === 1 ? '' : 's'} · ${usage.inputTokens + usage.outputTokens} reported tokens · ${usage.deterministicToolCalls} deterministic tool call${usage.deterministicToolCalls === 1 ? '' : 's'}${usage.cacheHit ? ' · cache hit' : ''} · ${usage.estimatedCostUsd == null ? 'Cost estimate unavailable' : `Estimated $${usage.estimatedCostUsd.toFixed(5)}`}.`;
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
  playback.show(result.workspace.scene?.type === 'website' ? result.workspace.steps.length - 1 : 0);
}


async function sendStreamRequest(request, onEvent) {
  const body = typeof request === 'string' ? { text: request } : { text: request.text, knowledgeMode: request.knowledgeMode, sketch: request.sketch, sketchLayout: request.sketchLayout };
  let response = await fetch('/api/run/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(testToken ? { 'x-bikting-test-token': testToken } : {}) }, body: JSON.stringify(body) });
  if (response.status === 401) {
    testToken = window.prompt('Enter your Bikting test access token:') ?? '';
    if (!testToken) throw new Error('A test access token is required.');
    response = await fetch('/api/run/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bikting-test-token': testToken }, body: JSON.stringify(body) });
  }
  if (!response.ok || !response.body) throw new Error(`Live execution failed (${response.status}).`);
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let result = null;
  const consume = (chunk) => {
    buffer += decoder.decode(chunk, { stream: true });
    const blocks = buffer.split('\n\n'); buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const event = block.match(/^event: (.+)$/m)?.[1]; const raw = block.match(/^data: (.+)$/m)?.[1]; if (!event || !raw) continue;
      const data = JSON.parse(raw); onEvent?.(event, data); if (event === 'result') result = data; if (event === 'error') throw new Error(data.message);
    }
  };
  while (true) { const { value, done } = await reader.read(); if (done) break; consume(value); }
  if (!result) throw new Error('The live execution stream ended without a result.');
  return result;
}

function sendRequest(request, path = '/api/run') {
  const body = typeof request === 'string' ? { text: request } : { text: request.text, knowledgeMode: request.knowledgeMode, sketch: request.sketch, sketchLayout: request.sketchLayout };
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
