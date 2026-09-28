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
  const stageTimer = setInterval(() => { if (!completed && run === latestRun) elements.stage.textContent = stages[Math.min(stageIndex++, stages.length - 1)]; }, 700);
  const showIntent = async () => {
    try {
      const response = await sendRequest(request, '/api/intent');
      if (!response.ok) return;
      const intent = await response.json();
      if (run !== latestRun || completed || !intent.scene) return;
      playback?.stop();
      renderGraph(elements.visual, intent.scene, 0);
      elements.title.textContent = intent.task ? 'Build intent sketch' : 'Relationship intent sketch';
      elements.explanation.textContent = intent.task ? `Intent: ${intent.task.action} ${intent.task.target}. Building from ${intent.relationships.map(({ from, relation, to }) => `${from} ${relation.replaceAll('_', ' ')} ${to}`).join(', ')}.` : `The engine found ${intent.relationships.length} relationships and is preparing the visual or build tool.`;
      elements.stage.textContent = 'GENERATING';
    } catch { /* The primary request still supplies the final result. */ }
  };
  void showIntent();
 …1078 tokens truncated…Listener('change', () => { const file = upload.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { image = new Image(); image.onload = () => { order = []; draw(); renderPieces(); }; image.src = reader.result; }; reader.readAsDataURL(file); });
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
