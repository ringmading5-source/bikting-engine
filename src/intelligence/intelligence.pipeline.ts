import { AuthorizationGrant } from "../core/access";
import { RelationshipTypeRegistry } from "../core/relationship.registry";
import { CapabilityRegistry } from "../capabilities/capability.registry";
import { KnowledgeRetriever } from "../knowledge/knowledge-retriever";
import { KnowledgeSourceRegistry } from "../knowledge/knowledge-source.registry";
import { ExecutionPlan } from "../planning/plan.types";
import { ContextCompiler, compileCapabilitySummaries } from "./context-compiler";
import { IntentInterpreter } from "./intent-interpreter";
import { IntentInterpretation } from "./intent-interpreter.types";
import { IntelligenceProviderRegistry } from "./intelligence-provider.registry";
import {
  IntelligenceConstraint,
  RawUserIntent,
  StructuredIntent,
} from "./intelligence-provider.types";
import { ProposalPlanningAdapter } from "./proposal-planning.adapter";
import { ReasoningService } from "./reasoning.service";
import { ReasoningBudget, ReasoningRunResult } from "./reasoning.types";

export interface IntelligencePipelineInput {
  projectId: string;
  raw: RawUserIntent;
  capabilities: CapabilityRegistry;
  knowledgeSources?: KnowledgeSourceRegistry;
  retriever?: KnowledgeRetriever;
  relationshipTypeRegistry?: RelationshipTypeRegistry;
  authorizationGrants?: readonly AuthorizationGrant[];
  constraints?: readonly IntelligenceConstraint[];
  budget?: Partial<ReasoningBudget>;
  providerId?: string;
  authorizedCapabilityIds?: readonly string[];
  defaultVerificationMethod?: string;
  /** Optional canonical requirements the planner already knows, e.g. from BIL compilation. */
  knowledgeRequirements?: readonly import("../knowledge/knowledge-requirement.types").KnowledgeRequirement[];
  bilContext?: import("../bil/bil.types").BilContext;
  knowledgeContext?: import("../knowledge/knowledge-context").KnowledgeContext;
  projectState?: Record<string, unknown>;
}

export interface IntelligencePipelineResult {
  interpretation: IntentInterpretation;
  intent: StructuredIntent;
  reasoningRun: ReasoningRunResult;
  /** Present only when the proposal was valid and could be planned. */
  plan?: ExecutionPlan;
  /** Set when planning was refused. The refusal reason is always explicit. */
  planningRefusal?: string;
}

/**
 * Human intent -> AI understands meaning -> Bikting structures the problem -> gathers knowledge
 * -> AI proposes -> Bikting validates and plans.
 *
 * The pipeline stops at a plan. It resolves no providers, holds no credentials, and executes
 * nothing: routing capabilities, authorization, execution, observation, and verification remain
 * separate downstream stages.
 */
export class IntelligencePipeline {
  private readonly interpreter: IntentInterpreter;
  private readonly reasoning: ReasoningService;
  private readonly planner: ProposalPlanningAdapter;

  constructor(providers: IntelligenceProviderRegistry) {
    if (!providers) throw new TypeError("An intelligence provider registry is required.");
    this.interpreter = new IntentInterpreter(providers);
    this.reasoning = new ReasoningService(providers, new ContextCompiler());
    this.planner = new ProposalPlanningAdapter();
  }

  async run(input: IntelligencePipelineInput): Promise<IntelligencePipelineResult> {
    const availableCapabilities = compileCapabilitySummaries(input.capabilities.list());
    const interpretation = await this.interpreter.interpret(
      { raw: input.raw, availableCapabilities, context: input.projectState },
      input.providerId,
    );
    if (!interpretation.valid) {
      return { interpretation, intent: interpretation.structuredIntent, reasoningRun: emptyRun(interpretation.providerId), planningRefusal: "The structured interpretation failed validation." };
    }
    const knowledgeRequirements = input.bilContext?.knowledgeRequirements.map(({ declaration }) => structuredClone(declaration)) ?? input.knowledgeRequirements?.map((item) => structuredClone(item)) ?? [];
    const reasoningRun = await this.reasoning.reason({
      projectId: input.projectId,
      intent: interpretation.structuredIntent,
      bilContext: input.bilContext,
      knowledgeContext: input.knowledgeContext,
      availableCapabilities,
      constraints: input.constraints,
      knowledgeSources: input.knowledgeSources,
      retriever: input.retriever,
      relationshipTypeRegistry: input.relationshipTypeRegistry,
      authorizationGrants: input.authorizationGrants,
      budget: input.budget,
      providerId: input.providerId,
      projectState: input.projectState,
      missingKnowledge: knowledgeRequirements.filter(({ id }) => input.knowledgeContext?.unresolvedRequirementIds.includes(id)).map(({ id, topic }) => ({ requirementId: id, topic, reason: "The planner requires this knowledge and Bikting could not resolve it." })),
    });
    if (!reasoningRun.valid) {
      return { interpretation, intent: interpretation.structuredIntent, reasoningRun, planningRefusal: `The proposal failed validation: ${reasoningRun.issues.map(({ code }) => code).join(", ")}` };
    }
    try {
      const plan = this.planner.createPlan({
        projectId: input.projectId,
        run: reasoningRun,
        capabilities: input.capabilities,
        bilContextId: input.bilContext?.id,
        knowledgeContextId: input.knowledgeContext?.id,
        authorizedCapabilityIds: input.authorizedCapabilityIds,
        defaultVerificationMethod: input.defaultVerificationMethod,
      });
      return { interpretation, intent: interpretation.structuredIntent, reasoningRun, plan };
    } catch (error) {
      return { interpretation, intent: interpretation.structuredIntent, reasoningRun, planningRefusal: error instanceof Error ? error.message : String(error) };
    }
  }
}

function emptyRun(providerId: string): ReasoningRunResult {
  return { reasoning: { id: "reasoning-none", objective: "", conclusions: [], proposedTasks: [], requiredCapabilities: [], additionalKnowledgeNeeds: [], outputRequirements: [], evidenceReferences: [], providerId }, requests: [], rounds: [], stopReason: "no_new_knowledge_needs", knowledgeRequirements: [], artifacts: [], issues: [{ code: "malformed_proposal", message: "Interpretation failed validation." }], valid: false, providerId };
}
