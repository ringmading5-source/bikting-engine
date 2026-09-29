export function presentResult(result, elements, { onStep, onPlay }) {
  const workspace = presentationFor(result);
  elements.title.textContent = workspace.title;
  elements.caption.textContent = workspace.summary;
  elements.explanation.classList.remove('empty-explanation');
  const moments = workspace.moments ?? workspace.steps;
  elements.count.textContent = `01 / ${String(moments.length).padStart(2, '0')}`;
  elements.play.disabled = !workspace.hasNarration && !workspace.scene?.states?.length;
  elements.play.querySelector('span').textContent = workspace.hasNarration ? 'Play voice + visual' : 'Play visualization';
  elements.previous.disabled = moments.length < 2;
  elements.next.disabled = moments.length < 2;
  elements.play.onclick = onPlay;
  elements.previous.onclick = () => onStep('previous');
  elements.next.onclick = () => onStep('next');
}

export function renderStep(step, index, total, state, elements) {
  elements.explanation.innerHTML = `<p class="step-kicker">STEP ${String(index + 1).padStart(2, '0')} · ${escapeHtml(step.title)}</p><p>${escapeHtml(step.display?.text ?? step.text)}</p>`;
  elements.count.textContent = `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
  elements.stage.textContent = state?.explanation?.toUpperCase() ?? 'READY';
  elements.progress.style.width = `${((index + 1) / total) * 100}%`;
  elements.previous.disabled = index === 0;
  elements.next.disabled = index === total - 1;
  return state;
}

function presentationFor(result) {
  if (result.workspace) return result.workspace;
  return {
    title: result.title,
    summary: result.summary,
    steps: result.explanation,
    hasNarration: Boolean(result.narration?.segments?.length),
  };
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
