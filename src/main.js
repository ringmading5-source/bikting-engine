import { readTextRequest } from './input/textInput.js';

const byId = (id) => document.getElementById(id);
const elements = { title: byId('workspace-title'), caption: byId('visual-caption'), explanation: byId('explanation'), count: byId('step-count'), play: byId('narrate-button'), previous: byId('previous-step'), next: byId('next-step'), progress: byId('progress-fill'), stage: byId('stage-label'), visual: byId('visualization') };

readTextRequest(byId('request-form'), byId('prompt'), (request) => runPipeline(request));

async function runPipeline(request) {
  elements.stage.textContent = 'PLANNING';
  let preview;
  try {
    const response = await fetch('/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: request.text }) });
    preview = await response.json();
    if (!response.ok) throw new Error(preview.error ?? 'The planner could not process this request.');
  } catch (error) {
    preview = { refusal: error.message, interpretation: { objective: request.text }, plan: null };
  }
  elements.title.textContent = preview.interpretation?.objective ?? 'Request';
  elements.stage.textContent = preview.plan ? 'PLAN READY' : 'NEEDS INPUT';
  elements.visual.replaceChildren();
  const summary = document.createElement('div');
  summary.style.padding = '2rem';
  summary.textContent = preview.plan ? `Plan: ${preview.plan.steps.length} steps. No tools have run.` : 'No plan could be produced for this request.';
  elements.visual.append(summary);
  elements.caption.textContent = 'Canonical intelligence pipeline · deterministic local preview';
  elements.explanation.textContent = preview.refusal ?? preview.conclusions?.join(' ') ?? 'The plan is ready for review.';
  elements.count.textContent = preview.plan ? `${preview.plan.steps.length} planned steps` : '—';
  elements.play.disabled = true;
  elements.previous.disabled = true;
  elements.next.disabled = true;
  renderTrace([
    { section: 'INTENT', detail: preview.interpretation?.objective ?? request.text },
    { section: 'INTERPRETATION', detail: preview.interpretation?.intentType ?? 'unknown' },
    ...(preview.plan?.steps ?? []).map((step) => ({ section: 'PLANNED', detail: `${step.action} · ${step.capabilityId ?? 'no capability'}` })),
    { section: preview.plan ? 'STATUS' : 'REFUSAL', detail: preview.plan ? 'Planning complete; execution has not started.' : preview.refusal ?? 'No plan.' },
  ]);
}

function renderTrace(trace = []) {
  byId('trace-status').textContent = `${trace.length} runtime stages complete`;
  byId('trace').innerHTML = trace.map((entry, index) => `<div class="trace-row done"><span>${String(index + 1).padStart(2, '0')}</span><b>${escapeHtml(entry.section)}</b><span>${escapeHtml(entry.detail)}</span></div>`).join('');
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
