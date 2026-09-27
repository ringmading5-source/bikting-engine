import { Entity } from "../core/types";
import { AccessRequirementDetail } from "../core/access";

export type AccessRequirement =
  | "free"
  | "account"
  | "subscription"
  | "usage_based"
  | "user_approval";

export interface CapabilityInput {
  name: string;
  type: string;
  required?: boolean;
}

export interface CapabilityOutput {
  name: string;
  type: string;
}

export interface CapabilityAccess {
  requirement: AccessRequirement;
  provider?: string;
  accountUrl?: string;
  price?: {
    amount: number;
    currency: string;
    interval?: string;
  };
  authentication?: AccessRequirementDetail["authentication"];
  permission?: AccessRequirementDetail["permission"];
  /** Credential type names or references only; never raw credential values. */
  credentials?: string[];
}

export interface Capability extends Entity {
  kind: "capability";
  inputs: CapabilityInput[];
  outputs: CapabilityOutput[];
  requires?: string[];
  compatibleWith?: string[];
  incompatibleWith?: string[];
  environmentRequirements?: string[];
  documentationUrl?: string;
  fallbackCapabilityIds?: string[];
  verificationMethod?: string;
  access?: CapabilityAccess;
  operations: string[];
}
