import { CapabilityRegistry } from "../capabilities/capability.registry";
import { IntelligencePipeline } from "../intelligence/intelligence.pipeline";
import { IntelligenceProviderRegistry } from "../intelligence/intelligence-provider.registry";
import { MockIntelligenceProvider } from "../intelligence/mock-intelligence.provider";

// Sample capabilities describe potential work. This preview never invokes them.
const capabilities = new CapabilityRegistry();
for (const [id, name, description, outputs] of [
  ["website.plan", "Website planning", "Outline pages, content, and implementation tasks", "site_plan"],
  ["knowledge.explain", "Knowledge explanation", "Explain a topic using retrieved evidence", "explanation"],
  ["visual.scene", "Visual scene", "Prepare a structured visual scene", "scene"],
] as const) {
  capabilities.registerCapability({ id, kind: "capability", name, description, operations: [id], inputs: [], outputs: [{ name: outputs, type: outputs }] });
}

const provider = new MockIntelligenceProvider({
  intentFixtures: [
    { match: "Build my personal website", intentType: "create", objective: "Plan a personal website", domain: "software", concepts: ["personal website"], requestedOutputs: ["site_plan"], possibleCapabilities: ["website.plan"] },
    { match: "Teach me about cells in biology", intentType: "learn", objective: "Explain biological cells", domain: "biology", concepts: ["cell"], requestedOutputs: ["explanation", "scene"], possibleCapabilities: ["knowledge.explain", "visual.scene"], knowledgeNeeds: [{ topic: "biological cells", required: true }] },
  ],
  reasoningFixtures: [
    { match: ({ intent }) => intent?.domain === "software", conclusions: ["A website plan can be prepared from the request."], proposedTasks: [{ purpose: "Outline the website", capabilityId: "website.plan" }] },
    { match: ({ intent }) => intent?.domain === "biology", conclusions: ["Evidence about cells is required before teaching factual details."], proposedTasks: [{ purpose: "Prepare a grounded explanation", capabilityId: "knowledge.explain" }, { purpose: "Prepare a visual scene", capabilityId: "visual.scene" }] },
  ],
});
const providers = new IntelligenceProviderRegistry();
providers.register(provider);
const pipeline = new IntelligencePipeline(providers);

/** Runs the canonical Phase 7 interpretation and planning path with declared demo fixtures. */
export async function previewIntent(text: string) {
  const result = await pipeline.run({
    projectId: "browser-preview",
    raw: { modality: "text", text },
    capabilities,
    authorizedCapabilityIds: capabilities.list().map(({ id }) => id),
    budget: { maxRounds: 1 },
  });
  const unresolvedKnowledge = result.intent.knowledgeNeeds.filter(({ required }) => required).map(({ topic }) => topic);
  return {
    mode: "deterministic_demo",
    interpretation: { valid: result.interpretation.valid, objective: result.intent.objective, intentType: result.intent.intentType, domain: result.intent.domain, concepts: result.intent.concepts, issues: result.interpretation.issues },
    knowledge: { needs: result.intent.knowledgeNeeds, unresolvedRequirementIds: result.reasoningRun.knowledgeContext?.unresolvedRequirementIds ?? [], unresolvedTopics: unresolvedKnowledge },
    planning: { valid: result.reasoningRun.valid, refusal: result.planningRefusal ?? (unresolvedKnowledge.length ? "Required knowledge has not been retrieved." : undefined), status: unresolvedKnowledge.length ? "blocked_knowledge" : result.plan?.status ?? "refused", steps: result.plan?.steps.map(({ id, capabilityId, dependsOn, status }) => ({ id, capabilityId, dependsOn, status })) ?? [] },
    execution: "not_started",
  };
}
