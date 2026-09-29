/** Compile a build request from the user's words and the engine's action relationship. */
export function compileBuildPrompt(semantic, requestText) {
  const task = semantic.context.task;
  return JSON.stringify({
    action: task.action, target: task.target, capability: task.capability,
    relationships: semantic.relationships.map(({ from, relation, to }) => ({ from, relation, to })),
    directions: semantic.relationships.map(({ from, relation, to }) => `Use ${from} ${relation} ${to}.`),
    requestedDetails: requestText,
    purpose: semantic.context.sentenceMeaning?.purpose ?? null,
    audienceConstraints: semantic.context.sentenceMeaning?.constraints ?? [],
    userSketch: semantic.context.sketch ? 'Attached PNG sketch supplied by the user. Preserve its layout intent.' : null,
    sketch: ['header with site name', 'main section reflecting requested details', 'about section', 'contact section with editable placeholder'],
    artifact: 'one self-contained responsive HTML file',
    constraints: ['Use semantic HTML and internal CSS.', 'Do not include JavaScript, external resources, forms, tracking, or invented business facts.', 'Use editable placeholders for missing facts.']
  });
}

/** Only static, self-contained HTML is accepted by the downloadable preview. */
export function validateGeneratedWebsite(html) {
  if (typeof html !== 'string' || html.length > 50000 || !/<html\b/i.test(html) || !/<body\b/i.test(html)) throw new Error('The generated website is not a complete HTML document.');
  if (/<\s*\/?\s*(script|iframe|object|embed|form|base|link|svg|math)\b|<meta\b[^>]*http-equiv|\bon[a-z]+\s*=|javascript\s*:|data\s*:|@import\b|url\s*\(|expression\s*\(|-moz-binding|\b(?:src|href|action|formaction)\s*=\s*["']?\s*(?:https?:|\/\/|&)/i.test(html)) throw new Error('The generated website includes unsupported active or external content.');
  return html;
}
