import { JsonModelTransport } from "../intelligence/json-intelligence.provider";

/** Server-only transport. API credentials never enter IntelligenceRequest or browser code. */
export function createOpenAITransport(apiKey: string, model: string, fetcher: typeof fetch = fetch): JsonModelTransport {
  if (!apiKey || !model) throw new TypeError("An API key and model name are required.");
  return async ({ task, instructions, input }) => {
    const response = await fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, store: false, instructions, input: JSON.stringify({ task, request: input }), text: { format: { type: "json_object" } } }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Model request failed (HTTP ${response.status}).`);
    const body = await response.json() as { status?: string; output?: { content?: { type?: string; text?: string }[] }[] };
    if (body.status !== "completed") throw new Error("Model response was not completed.");
    const output = body.output?.flatMap(({ content }) => content ?? []).filter(({ type }) => type === "output_text").map(({ text }) => text ?? "").join("");
    if (!output || output.length > 100_000) throw new Error("Model response is empty or too large.");
    try { return JSON.parse(output) as unknown; } catch { throw new Error("Model response was not valid JSON."); }
  };
}
