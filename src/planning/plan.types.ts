import { AuthorizationRequirement } from "../core/access";
import { UserIntent } from "../intent/intent.types";
import { PlanInputBinding } from "./input-binding.types";
import type { KnowledgeContext } from "../knowledge/knowledge-context";

export interface PlanProvenanceReference {
  sourceType: "bil" | "engine";
  contextId?: string;
  moduleId?: string;
  moduleVersion?: string;
  category?: string;
  declarationId?: string;
}

export interface PlanVerificationRequirement {
  id: string;
  method: string;
  required: boolean;
  capabilityId?: string;
  description?: string;
  provenance?: PlanProvenanceReference[];
}

export interface PlanExecutionRequirement {
  id: string;
  type: string;
  value?: string | number | boolean | string[];
  required?: boolean;
  provenance?: PlanProvenanceReference[];
}

export interface PlanOutputRequirement {
  id: string;
  type: string;
  required: boolean;
  capabilityId?: string;
  provenance?: PlanProvenanceReference[];
}

export interface PlanConstraintRequirement {
  type: string;
  value: unknown;
  provenance?: PlanProvenanceReference[];
}

export interface PlanStep {
  id: string;
  action: string;
  capabilityId?: string;
  selectedProviderId?: string;
  inputs?: Record<string, unknown>;
  inputBindings?: PlanInputBinding[];
  expectedInputs?: Array<{ name: string; type: string; required?: boolean }>;
  expectedOutputs?: Array<{ name: string; type: string }>;
  dependsOn?: string[];
  requiredAccess?: Array<{
    capabilityId: string;
    requirement: string;
    provider?: string;
  }>;
  authorizationRequirements?: AuthorizationRequirement[];
  executionRequirements?: PlanExecutionRequirement[];
  verificationRequirements?: PlanVerificationRequirement[];
  outputRequirements?: PlanOutputRequirement[];
  provenance?: PlanProvenanceReference[];
  verification?: {
    method: string;
    required?: boolean;
  };
  status: "pending" | "running" | "completed" | "failed";
}

export interface ExecutionPlan {
  id: string;
  goal: string;
  originatingIntent?: UserIntent;
  bilContextId?: string;
  knowledgeContextId?: string;
  knowledgeContext?: KnowledgeContext;
  unresolvedKnowledgeRequirementIds?: string[];
  steps: PlanStep[];
  constraints?: Array<{ type: string; value: unknown }>;
  canonicalConstraints?: PlanConstraintRequirement[];
  requiredCapabilityIds?: string[];
  requiredKnowledgeIds?: string[];
  requiredResourceIds?: string[];
  requiredPermissions?: string[];
  estimatedCost?: { amount: number; currency: string; interval?: string };
  verificationRequirements?: string[];
  canonicalVerificationRequirements?: PlanVerificationRequirement[];
  executionRequirements?: PlanExecutionRequirement[];
  outputRequirements?: PlanOutputRequirement[];
  unresolvedCapabilityIds?: string[];
  provenance?: PlanProvenanceReference[];
  status: "draft" | "ready" | "running" | "completed" | "failed";
}
