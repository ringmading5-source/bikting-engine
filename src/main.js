import { readTextRequest } from './input/textInput.js';
import { renderMathResult } from './workspace/mathVisual.js';

const byId = (id) => document.getElementById(id);
const elements = { title: byId('workspace-title'), caption: byId('visual-caption'), explanation: byId('explanation'), count: byId('step-count'), play: byId('narrate-button'), previous: byId('previous-step'), next: byId('next-step'), progress: byId('progress-fill'), stage: byId('stage-label'), visual: byId('visualization') };
const calculationButton = byId('calculate-button');
const scaffoldButton = byId('scaffold-button');
const agentButton = byId('agent-button');
let voiceEnabled = false;
elements.play.disabled = !('speechSynthesis' in window);
elements.play.onclick = () => {
  voiceEnabled = !voiceEnabled;
  if (!voiceEnabled) speechSynthesis.cancel();
  elements.play.querySelector('span').textContent = voiceEnabled ? 'Mute live voice' : 'Enable live voice';
};
function speak(message) {
  if (!voiceEnabled || !('speechSynthesis' in window)) return;
  speechSynthesis.speak(new SpeechSynthesisUtterance(message));
}
async function readLiveRun(endpoint, input, onEntry) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  if (!response.ok) { const payload = await response.json(); throw new Error(payload.error ?? 'Calculation failed.'); }
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let buffer = '', result;
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const entry = JSON.parse(line);
      onEntry(entry);
      if (entry.kind === 'error') throw new Error(entry.error);
      if (entry.kind === 'result') result = entry.result;
    }
    if (done) break;
  }
  if (!result) throw new Error('The execution stream ended without a verified result.');
  return result;
}

readTextRequest(byId('request-form'), byId('prompt'), (request) => runPipeline(request));

async function runPipeline(request) {
  calculationButton.hidden = true;
  scaffoldButton.hidden = true;
  agentButton.hidden = true;
  let route; let workerAvailable = false;
  try {
    const response = await fetch('/api/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: request.text }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? 'The router could not process this request.');
    route = payload.route;
    workerAvailable = payload.workerAvailable === true;
  } catch (error) {
    elements.stage.textContent = 'ROUTING FAILED'; elements.explanation.textContent = error.message; return;
  }
  if (route && route.id !== 'public-knowledge' && workerAvailable) {
    agentButton.hidden = false;
    agentButton.onclick = async () => {
      agentButton.disabled = true;
      elements.stage.textContent = 'LLM WORKING';
      const trace = [{ section: 'GOAL', detail: request.text }];
      try {
        const result = await readLiveRun('/api/agent/live', { goal: request.text }, (entry) => {
          if (entry.kind !== 'event') return;
          trace.push({ section: 'WORKER', detail: `${entry.event.type}: ${entry.event.detail}` });
          renderTrace(trace);
          if (entry.event.type === 'tool_started' || entry.event.type === 'tool_completed') speak(entry.event.detail);
        });
        elements.stage.textContent = 'VERIFIED';
        elements.explanation.textContent = `${result.summary} · ${result.observations.length} verified tool result.`;
        const observation = result.observations[0];
        if (observation.capabilityId === 'math.calculate') renderMathResult(elements.visual, route.inputs.expression, observation.output.numericResult);
        else elements.visual.textContent = `Generated and verified: ${observation.output.fileNames.join(', ')}`;
      } catch (error) { elements.stage.textContent = 'WORKER FAILED'; elements.explanation.textContent = error.message; }
      finally { agentButton.disabled = false; }
    };
  }
  const expression = route?.id === 'arithmetic' ? route.inputs.expression : null;
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
        const trace = [{ section: 'PLAN', detail: 'math.calculate · math.calculator' }];
        const narration = { execution_started: 'Starting the approved calculation.', provider_invoked: 'The local calculator is working.', verification_started: 'Checking the result.', step_succeeded: 'The result passed verification.' };
        elements.stage.textContent = 'RUNNING';
        const output = await readLiveRun('/api/calculate/live', { expression }, (entry) => {
          if (entry.kind !== 'event') return;
          trace.push({ section: 'LIVE', detail: `${entry.event.sequence}. ${entry.event.type.replaceAll('_', ' ')}${entry.event.providerId ? ` · ${entry.event.providerId}` : ''}` });
          renderTrace(trace);
          const line = narration[entry.event.type];
          if (line) { elements.explanation.textContent = line; speak(line); }
        });
        elements.explanation.textContent = `${output.expression} = ${output.value}. Verified by the local calculator.`;
        elements.stage.textContent = 'VERIFIED';
        renderMathResult(elements.visual, output.expression, output.value);
        elements.caption.textContent = 'Verified result · signed number line';
        trace.push({ section: 'VERIFICATION', detail: `Expression check passed. Result: ${output.value}` });
        renderTrace(trace);
        speak(`The verified answer is ${output.value}.`);
      } catch (error) { elements.explanation.textContent = error.message; elements.stage.textContent = 'FAILED'; }
      finally { calculationButton.disabled = false; }
    };
    renderTrace([{ section: 'INTENT', detail: request.text }, { section: 'PLAN', detail: 'math.calculate · local deterministic provider' }, { section: 'STATUS', detail: 'Waiting for explicit run action' }]);
    return;
  }
  const topic = route?.id === 'public-knowledge' ? route.inputs.topic : null;
  if (topic) {
    elements.title.textContent = `Knowledge search: ${topic}`;
    elements.stage.textContent = 'SEARCHING';
    elements.visual.textContent = 'Searching a public knowledge source…';
    elements.caption.textContent = 'Public Wikipedia search · linked evidence';
    elements.explanation.textContent = 'Searching for source material. Read the linked articles to check relevance and accuracy.';
    try {
      const trace = [{ section: 'KNOWLEDGE', detail: `Public search: ${topic}` }];
      const found = await readLiveRun('/api/knowledge/live', { topic }, (entry) => {
        if (entry.kind !== 'event') return;
        trace.push({ section: 'LIVE', detail: `${entry.event.type.replaceAll('_', ' ')} · ${entry.event.providerId}` });
        renderTrace(trace);
        if (entry.event.type === 'knowledge_retrieval_started') speak('Searching the public knowledge source.');
        if (entry.event.type === 'knowledge_retrieval_completed') speak(`Found ${entry.event.data.count} source links.`);
      });
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
      trace.push({ section: 'SOURCE', detail: 'Wikipedia · read-only; snippets are not a verified lesson' }); renderTrace(trace);
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
        const trace = [{ section: 'PLAN', detail: preview.plan.id }];
        elements.stage.textContent = 'GENERATING';
        const output = await readLiveRun('/api/scaffold/live', { text: request.text, planId: preview.plan.id }, (entry) => {
          if (entry.kind !== 'event') return;
          trace.push({ section: 'LIVE', detail: `${entry.event.sequence}. ${entry.event.type.replaceAll('_', ' ')}${entry.event.providerId ? ` · ${entry.event.providerId}` : ''}` });
          renderTrace(trace);
          if (entry.event.type === 'provider_invoked') speak('The website scaffold tool is generating files.');
          if (entry.event.type === 'step_succeeded') speak('The website files passed verification.');
        });
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
        trace.push({ section: 'OUTPUT', detail: `${Object.keys(output.files).length} validated project files` }); renderTrace(trace);
      } catch (error) { elements.explanation.textContent = error.message; elements.stage.textContent = 'FAILED'; }
      finally { scaffoldButton.disabled = false; }
    };
  }
  elements.count.textContent = preview.plan ? `${preview.plan.steps.length} planned steps` : '—';
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
    ...(preview.capabilityResolution?.actions ?? []).map((action) => ({ section: 'NEXT ACTION', detail: `${action.type.replaceAll('_', ' ')}: ${action.message}${action.candidateOffers?.length ? ` Catalog offers: ${action.candidateOffers.map(({ providerId }) => providerId).join(', ')}.` : ''}` })),
    { section: preview.plan ? 'STATUS' : 'REFUSAL', detail: preview.plan ? 'Planning complete; execution has not started.' : preview.refusal ?? 'No plan.' },
  ]);
}

function renderTrace(trace = []) {
  byId('trace-status').textContent = `${trace.length} runtime stages complete`;
  byId('trace').innerHTML = trace.map((entry, index) => `<div class="trace-row done"><span>${String(index + 1).padStart(2, '0')}</span><b>${escapeHtml(entry.section)}</b><span>${escapeHtml(entry.detail)}</span></div>`).join('');
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
