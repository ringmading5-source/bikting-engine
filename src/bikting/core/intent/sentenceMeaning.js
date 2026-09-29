/** Small structural frame; unfamiliar phrasing remains for the model or clarification. */
export function sentenceMeaning(text, projectContext = null) {
  const value = String(text ?? '').trim();
  const purpose = /\bfor\s+(teaching|learning|studying|sharing|selling)\s+([^,.;!?]+)/i.exec(value);
  const level = /\bas if\s+(?:i(?:'|’)m|i am|we are)\s+(?:a\s+)?(beginner|expert|child)/i.exec(value);
  const reference = /\b(it|its|this|that|the website|the site|the page)\b/i.exec(value)?.[1]?.toLowerCase() ?? null;
  return { purpose: purpose ? { activity: purpose[1].toLowerCase(), subject: purpose[2].trim() } : null,
    constraints: level ? [{ kind: 'audience_level', value: level[1].toLowerCase() }] : [],
    reference: reference ? { expression: reference, resolved: projectContext?.type === 'website' ? { type: 'website', title: projectContext.title ?? 'Website' } : null } : null };
}
