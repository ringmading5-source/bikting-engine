import { readTextRequest } from './input/textInput.js';

const byId = (id) => document.getElementById(id);
const elements = { title: byId('workspace-title'), caption: byId('visual-caption'), explanation: byId('explanation'), count: byId('step-count'), play: byId('narrate-button'), previous: byId('previous-step'), next: byId('next-step'), progress: byId('progress-fill'), stage: byId('stage-label'), visual: byId('visualization') };
const calculationButton = byId('calculate-button');
const scaffoldButton = byId('scaffold-button');

readTextRequest(byId('request-form'), byId('prompt'), (request) => runPipeline(request));

async function runPipeline(request) {
  calculationButton.hidden = true;
  scaffoldButton.hidden = true;
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
  const topic = /^\s*(?:teach me|explain|learn about)\s+(.+?)\s*[.!?]?\s*$/i.exec(request.text)?.[1]?.trim();
  if (topic) {
    elements.title.textContent = `Knowledge search: ${topic}`;
    elements.stage.textContent = 'SEARCHING';
    elements.visual.textContent = 'Searching a public knowledge source…';
    elements.caption.textContent = 'Public Wikipedia search · linked evidence';
    elements.explanation.textContent = 'Searching for source material. Read the linked articles to check relevance and accuracy.';
    try {
      const response = await fetch('/api/knowledge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic }) });
      const found = await response.json();
      if (!response.ok) throw new Error(found.error ?? 'Search failed.');
      elements.visual.replaceChildren();
      for (const item of found.results) {
        const article = document.createElement('article'); article.style.cssText = 'padding:1rem;width:100%';
        const link = document.createElement('a'); link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = item.title;
        const excerpt = document.createElement('p'); excerpt.textContent = item.snippet;
        article.append(link, excerpt); elements.visual.append(article);
      }
      elements.stage.textContent = found.results.length ? 'SOURCES FOUND' : 'NO RESULTS';
      elements.explanation.textContent = `${found.results.length} public source links found for “${found.topic}”. These search snippets are not a verified lesson.`;
      elements.count.textContent = `${found.results.length} sources`;
      renderTrace([{ section: 'INTENT', detail: request.text }, { section: 'KNOWLEDGE', detail: `Public search: ${found.topic}` }, { section: 'SOURCE', detail: 'Wikipedia · read-only' }]);
    } catch (error) { elements.stage.textContent = 'SEARCH FAILED'; elements.explanation.textContent = error.message; elements.visual.textContent = 'The public source could not be reached.'; }
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
  if (preview.plan?.status === 'ready' && preview.plan.steps.length === 1 && preview.plan.steps[0].capabilityId === 'code.scaffold' && preview.stepReadiness?.[0]?.state === 'ready_for_review') {
    scaffoldButton.hidden = false;
    scaffoldButton.onclick = async () => {
      scaffoldButton.disabled = true;
      try {
        const response = await fetch('/api/scaffold', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: request.text, planId: preview.plan.id }) });
        const output = await response.json();
        if (!response.ok) throw new Error(output.error ?? 'Website generation failed.');
        elements.stage.textContent = 'FILES READY';
        elements.explanation.textContent = 'Generated a local website starter. Edit the placeholder name, projects, and contact section before sharing it.';
        elements.visual.replaceChildren();
        for (const [name, content] of Object.entries(output.files)) {
          const group = document.createElement('div');
          group.style.cssText = 'padding:1rem;min-width:0;width:100%';
          const heading = document.createElement('strong'); heading.textContent = name;
          const download = document.createElement('a'); download.textContent = ' Download'; download.download = name;
          download.href = URL.createObjectURL(new Blob([content], { type: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript' }));
          const source = document.createElement('pre'); source.textContent = content; source.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:15rem;overflow:auto';
          group.append(heading, download, source); elements.visual.append(group);
        }
        renderTrace([{ section: 'PLAN', detail: output.planId }, { section: 'PROVIDER', detail: output.providerId }, { section: 'OUTPUT', detail: `${Object.keys(output.files).length} validated project files` }]);
      } catch (error) { elements.explanation.textContent = error.message; elements.stage.textContent = 'FAILED'; }
      finally { scaffoldButton.disabled = false; }
    };
  }
  elements.count.textContent = preview.plan ? `${preview.plan.steps.length} planned steps` : '—';
  elements.play.disabled = true;
  elements.previous.disabled = true;
  elements.next.disabled = true;
  renderTrace([
    { section: 'INTENT', detail: preview.interpretation?.objective ?? request.text },
    { section: 'INTERPRETATION', detail: preview.interpretation?.intentType ?? 'unknown' },
    ...(preview.installedTools ?? []).map((tool) => ({ section: 'BUILT-IN TOOL', detail: `${tool.id}: ${tool.description} · ${tool.capabilityId}` })),
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
