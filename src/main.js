import { readTextRequest } from './input/textInput.js';

const byId = (id) => document.getElementById(id);
const elements = { title: byId('workspace-title'), caption: byId('visual-caption'), explanation: byId('explanation'), count: byId('step-count'), play: byId('narrate-button'), previous: byId('previous-step'), next: byId('next-step'), progress: byId('progress-fill'), stage: byId('stage-label'), visual: byId('visualization') };
const calculationButton = byId('calculate-button');

readTextRequest(byId('request-form'), byId('prompt'), (request) => runPipeline(request));

async function runPipeline(request) {
  calculationButton.hidden = true;
  const expression = /^\s*calculate\s+([\d\s.+\-*/%^()×÷eE]+)\s*$/i.exec(request.text)?.[1]?.trim();
  if (expression) {
    elements.title.textContent = 'Local arithmetic';
    elements.stage.textContent = 'READY';
    elements.visual.textContent = `Expression: ${expression}`;
    elements.explanation.textContent = 'Ready to run the local deterministic calculator. Click Run local calculation to execute and verify it.';
    elements.count.textContent = '1 step';
    elements.caption.textContent = 'Local math only · explicit action required';
    calculationButton.hidden = false;
    calculationButton.onclick = async () => {
      calculationButton.disabled = true;
      try {
        const response = await fetch('/api/calculate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expression }) });
        const output = await response.json();
        if (!response.ok) throw new Error(output.error ?? 'Calculation failed.');
        elements.explanation.textContent = `${output.expression} = ${output.value}. Verified by the local calculator.`;
        elements.stage.textContent = 'VERIFIED';
        renderTrace([{ section: 'PROVIDER', detail: output.providerId }, { section: 'VERIFICATION', detail: `Expression check passed. Result: ${output.value}` }]);
      } catch (error) { elements.explanation.textContent = error.message; elements.stage.textContent = 'FAILED'; }
      finally { calculationButton.disabled = false; }
    };
    renderTrace([{ section: 'INTENT', detail: request.text }, { section: 'PLAN', detail: 'math.calculate · local deterministic provider' }, { section: 'STATUS', detail: 'Waiting for explicit run action' }]);
    return;
  }
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
  elements.caption.textContent = `Canonical intelligence pipeline · ${preview.mode ?? 'unavailable'} · no execution`;
  elements.explanation.textContent = preview.refusal ?? preview.conclusions?.join(' ') ?? 'The plan is ready for review.';
  elements.count.textContent = preview.plan ? `${preview.plan.steps.length} planned steps` : '—';
  elements.play.disabled = true;
  elements.previous.disabled = true;
  elements.next.disabled = true;
  renderTrace([
    { section: 'INTENT', detail: preview.interpretation?.objective ?? request.text },
    { section: 'INTERPRETATION', detail: preview.interpretation?.intentType ?? 'unknown' },
    ...(preview.missingKnowledge ?? []).map((topic) => ({ section: 'KNOWLEDGE NEEDED', detail: topic })),
    ...(preview.planningIssues ?? []).map((issue) => ({ section: 'VALIDATION', detail: issue })),
    ...(preview.plan?.steps ?? []).map((step) => ({ section: 'PLANNED', detail: `${step.action} · ${step.capabilityId ?? 'no capability'}` })),
    ...(preview.stepReadiness ?? []).map((step) => ({ section: 'ACCESS', detail: `${step.capabilityId}: ${step.state.replaceAll('_', ' ')}. ${step.reason}${step.accountSteps?.length ? ` Account: ${step.accountSteps.join(', ')}.` : ''}${step.permissions?.length ? ` Permissions: ${step.permissions.join(', ')}.` : ''}` })),
    { section: preview.plan ? 'STATUS' : 'REFUSAL', detail: preview.plan ? 'Planning complete; execution has not started.' : preview.refusal ?? 'No plan.' },
  ]);
}

function renderTrace(trace = []) {
  byId('trace-status').textContent = `${trace.length} runtime stages complete`;
  byId('trace').innerHTML = trace.map((entry, index) => `<div class="trace-row done"><span>${String(index + 1).padStart(2, '0')}</span><b>${escapeHtml(entry.section)}</b><span>${escapeHtml(entry.detail)}</span></div>`).join('');
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
