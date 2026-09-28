export function renderKnowledge(container, knowledge) {
  container.replaceChildren();
  if (!knowledge) return;
  const details = document.createElement('details');
  const summary = document.createElement('summary'); summary.textContent = knowledge.mode === 'web-grounded' ? 'Knowledge and web sources' : 'Gemini knowledge'; details.append(summary);
  const warning = document.createElement('p'); warning.textContent = knowledge.warning; details.append(warning);
  for (const support of knowledge.supports ?? []) {
    const paragraph = document.createElement('p'); paragraph.textContent = support.text + ' ';
    for (const id of support.sourceIds) {
      const source = knowledge.sources.find(s => s.id === id);
      if (source && /^https?:\/\//i.test(source.url)) { const link = document.createElement('a'); link.href = source.url; link.textContent = `[${id + 1}] `; link.target = '_blank'; link.rel = 'noopener noreferrer'; paragraph.append(link); }
    }
    details.append(paragraph);
  }
  for (const source of knowledge.sources ?? []) {
    if (!/^https?:\/\//i.test(source.url)) continue;
    const link = document.createElement('a'); link.href = source.url; link.textContent = source.title; link.target = '_blank'; link.rel = 'noopener noreferrer'; const p = document.createElement('p'); p.append(link); details.append(p);
  }
  if (knowledge.searchSuggestions) {
    const frame = document.createElement('iframe'); frame.title = 'Google Search suggestions'; frame.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox'); frame.referrerPolicy = 'no-referrer'; frame.srcdoc = knowledge.searchSuggestions; details.append(frame);
  }
  container.append(details);
}
