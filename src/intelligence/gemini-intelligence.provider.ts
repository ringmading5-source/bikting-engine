import type { IntelligenceProvider, IntelligenceRequest, StructuredIntent, ReasoningResult, IntelligenceCapabilities } from './intelligence-provider.types';

type Fetcher = typeof fetch;

/** Gemini translates model output into Bikting's untrusted proposal contracts. */
export class GeminiIntelligenceProvider implements IntelligenceProvider {
  readonly id = 'gemini.remote';
  readonly name = 'Gemini intent and planning provider';
  readonly capabilities: IntelligenceCapabilities = { tasks: ['interpret_intent', 'reason'], supportsStructuredOutput: true };

  constructor(private readonly config: { apiKey: string; model: string; fetcher?: Fetcher }) {
    if (!config.apiKey) throw new TypeError('A Gemini API key is required.');
    if (!/^[a-zA-Z0-9._-]+$/.test(config.model)) throw new TypeError('Invalid Gemini model name.');
  }

  async interpretIntent(request: IntelligenceRequest): Promise<StructuredIntent> {
    const raw = await this.generate({
      instruction: 'Interpret the user request into Bikting structured intent. Use only the listed capability IDs. Express uncertainty explicitly. Do not assert domain facts or invent retrieved knowledge. Output JSON only.',
      request,
      output: {
        objective: 'nonempty string', intentType: 'create|learn|explain|analyze|calculate|compare|transform|automate|unknown',
        domain: 'optional string', target: 'optional string', concepts: ['string'],
        relationships: [{ from: 'string', to: 'string', type: 'optional string' }],
        requestedOutputs: ['string'], possibleCapabilities: ['registered capability ID'],
        knowledgeNeeds: [{ topic: 'string', domain: 'optional string', required: true }],
        requestedDepth: 'overview|detailed|expert (optional)',
      },
    });
    const data = record(raw);
    return {
      id: `intent-${request.id}`, modality: request.input?.modality ?? 'text',
      objective: requiredString(data.objective, 'objective'),
      intentType: requiredString(data.intentType, 'intentType') as StructuredIntent['intentType'],
      domain: optionalString(data.domain), target: optionalString(data.target),
      concepts: strings(data.concepts), relationships: objects(data.relationships).map((item) => ({ from: requiredString(item.from, 'from'), to: requiredString(item.to, 'to'), type: optionalString(item.type) })),
      requestedOutputs: strings(data.requestedOutputs), possibleCapabilities: strings(data.possibleCapabilities),
      knowledgeNeeds: objects(data.knowledgeNeeds).map((item) => ({ topic: requiredString(item.topic, 'topic'), domain: optionalString(item.domain), required: item.required !== false })),
      constraints: [...(request.input?.constraints ?? [])],
      requestedDepth: data.requestedDepth as StructuredIntent['requestedDepth'], providerId: this.id,
    };
  }

  async reason(request: IntelligenceRequest): Promise<ReasoningResult> {
    const raw = await this.generate({
      instruction: 'Propose a plan, never execute. Use only offered capability IDs. Keep objective exactly equal to request.objective. For factual teaching without retrieved evidence, request missing knowledge and propose no teaching or visual tasks. Never claim an evidence reference absent from knowledgeContext. Do not invent dependencies. Output JSON only.',
      request,
      output: {
        conclusions: ['short string'], proposedTasks: [{ purpose: 'string', capabilityId: 'registered capability ID', required: true }],
        additionalKnowledgeNeeds: [{ topic: 'string', domain: 'optional string', required: true }],
        outputRequirements: [{ type: 'string', required: true, capabilityId: 'optional registered capability ID' }],
      },
    });
    const data = record(raw);
    const modelTasks = objects(data.proposedTasks).map((item, index) => ({
      id: `task-${index + 1}`, purpose: requiredString(item.purpose, 'purpose'),
      capabilityId: requiredString(item.capabilityId, 'capabilityId'), dependsOn: [] as string[], required: item.required !== false,
    }));
    const modelNeeds = objects(data.additionalKnowledgeNeeds).map((item) => ({ topic: requiredString(item.topic, 'topic'), domain: optionalString(item.domain), required: item.required !== false }));
    const needsEvidence = ['learn', 'explain'].includes(request.intent?.intentType ?? '') && !request.knowledgeContext?.concepts.length;
    const additionalKnowledgeNeeds = needsEvidence && !modelNeeds.length
      ? (request.intent?.concepts ?? []).map((topic) => ({ topic, domain: request.intent?.domain, required: true }))
      : modelNeeds;
    const proposedTasks = needsEvidence ? [] : modelTasks;
    return {
      id: `reasoning-${request.id}`, objective: request.objective,
      conclusions: strings(data.conclusions), proposedTasks,
      requiredCapabilities: proposedTasks.map(({ capabilityId, purpose, required }) => ({ capabilityId, purpose, required })),
      additionalKnowledgeNeeds,
      outputRequirements: objects(data.outputRequirements).map((item) => ({ type: requiredString(item.type, 'type'), required: item.required !== false, capabilityId: optionalString(item.capabilityId) })),
      evidenceReferences: [], providerId: this.id,
    };
  }

  private async generate(payload: unknown): Promise<unknown> {
    const response = await (this.config.fetcher ?? fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:generateContent`, {
      method: 'POST', headers: { 'x-goog-api-key': this.config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: JSON.stringify(payload) }] }], generationConfig: { responseMimeType: 'application/json' } }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Gemini request failed (${response.status}).`);
    const body = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = body.candidates?.[0]?.content?.parts?.map(({ text }) => text ?? '').join('');
    if (!text) throw new Error('Gemini returned no JSON response.');
    try { return JSON.parse(text); } catch { throw new Error('Gemini returned invalid JSON.'); }
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Gemini response must be a JSON object.');
  return value as Record<string, unknown>;
}
function objects(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('Gemini response is missing an array.');
  return value.map(record);
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new Error('Gemini response is missing a string array.');
  return value;
}
function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Gemini response is missing ${field}.`);
  return value;
}
function optionalString(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
