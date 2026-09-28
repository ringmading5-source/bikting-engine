import type { GoalClarifier, GoalSuggestion } from './goal-engine';

/** One remote interpretation call; output is a question, never an execution command. */
export function createGeminiGoalClarifier(config: { apiKey: string; model: string; fetcher?: typeof fetch }): GoalClarifier {
  if (!config.apiKey || !/^[a-zA-Z0-9._-]+$/.test(config.model)) throw new TypeError('Valid Gemini clarifier configuration required.');
  return { async suggest(goal) {
    const response = await (config.fetcher ?? fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`, {
      method: 'POST', headers: { 'x-goog-api-key': config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: JSON.stringify({ instruction: 'Interpret ambiguity only. Return JSON with inferredGoal (short user-facing goal), category (calculate|website|learn|unknown), question (one clarification). Do not request tools or claim work done. A user must confirm before execution.', goal }) }] }], generationConfig: { responseMimeType: 'application/json' } }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Intent clarifier failed (${response.status}).`);
    const body = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = body.candidates?.[0]?.content?.parts?.map(({ text }) => text ?? '').join('');
    if (!text || text.length > 4000) throw new Error('Intent clarifier returned no bounded response.');
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new Error('Intent clarifier returned invalid JSON.'); }
    return value as GoalSuggestion;
  } };
}
