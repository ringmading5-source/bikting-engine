import { CapabilityRegistry } from "../capabilities/capability.registry";
import { resolveRelatedCapabilities } from "../capabilities/capability.resolver";
import { Capability } from "../capabilities/capability.types";
import { ExecutionExecutor } from "../execution/executor";
import { createContext, BiktingContext } from "./context";
import { BiktingGraph } from "./graph";
import { ObservabilityLog } from "./observability";
import { Entity, Relationship } from "./types";
import { UserIntent } from "../intent/intent.types";
import { KnowledgeRegistry } from "../knowledge/knowledge.module";
import { KnowledgeModule } from "../knowledge/knowledge.types";
import { Planner } from "../planning/planner";
import { ExecutionPlan } from "../planning/plan.types";

/**
 * TypeScript façade for the modular Bikting core architecture.
 * Capability and knowledge resolution will be connected in a later phase.
 */
export class BiktingEngine {
  public graph: BiktingGraph;
  public knowledge: KnowledgeRegistry;
  public capabilities: CapabilityRegistry;
  public planner: Planner;
  public executor: ExecutionExecutor;
  public context: BiktingContext;
  public log: ObservabilityLog;

  constructor() {
    this.graph = new BiktingGraph();
    this.knowledge = new KnowledgeRegistry();
    this.capabilities = new CapabilityRegistry();
    this.planner = new Planner(this.capabilities);
    this.executor = new ExecutionExecutor();
    this.context = createContext();
    this.log = new ObservabilityLog();
  }

  registerEntity(entity: Entity): void {
    this.graph.addEntity(entity);
  }

  registerRelationship(relationship: Relationship): void {
    this.graph.addRelationship(relationship);
  }

  registerKnowledgeModule(module: KnowledgeModule): KnowledgeModule {
    const registered = this.knowledge.registerModule(module, this.graph);
    this.log.record("knowledge", `Registered ${registered.id}`);
    return registered;
  }

  registerCapability(capability: Capability): Capability {
    const registered = this.capabilities.registerCapability(capability, this.graph);
    this.log.record("capability", `Registered ${registered.id}`);
    return registered;
  }

  resolveRelatedCapabilities(capabilityId: string): Capability[] {
    return resolveRelatedCapabilities(this.capabilities, capabilityId);
  }

  async processIntent(intent: UserIntent): Promise<ExecutionPlan> {
    this.context.currentIntentId = intent.goal;
    this.log.record("intent", intent.goal, { actions: intent.actions ?? [] });
    const plan = this.planner.createPlan(intent);
    this.log.record("planning", `Created ${plan.id}`, { status: plan.status });
    return plan;
  }
}
