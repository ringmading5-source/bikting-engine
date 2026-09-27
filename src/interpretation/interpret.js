const patterns = [
  { id: 'electric_motor', domain: 'science', match: /\b(electric\s+)?motor(s)?\b/i, concepts: ['electric current', 'magnetic field', 'force', 'rotation'] },
  { id: 'photosynthesis', domain: 'biology', match: /photosynthesis/i, concepts: ['light', 'water', 'carbon dioxide', 'glucose', 'oxygen'] },
  { id: 'equation', domain: 'mathematics', match: /\b(calculate|solve|equation|\d+\s*[+*/=-])\b/i, concepts: [] },
  { id: 'website', domain: 'coding', match: /\b(build|create|make)\b.*\b(website|web app|site)\b/i, concepts: [] },
];

export function interpret(request) {
  const match = patterns.find((pattern) => pattern.match.test(request.text));
  const question = /\b(why|what|how|when|where|who|explain|describe)\b/i.test(request.text);
  return {
    source: request.type,
    rawText: request.text,
    intent: match?.id ?? (question ? 'explain' : 'create_or_analyze'),
    domain: match?.domain ?? 'general',
    concepts: match?.concepts ?? extractTerms(request.text),
    goal: match ? `Respond to a ${match.domain} request about ${match.id.replaceAll('_', ' ')}` : 'Respond to the user request using available modules and tools',
    confidence: match ? 0.94 : 0.48,
  };
}

function extractTerms(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter((word) => word.length > 3).slice(0, 8);
}
