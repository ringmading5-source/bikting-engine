export type AuthenticationRequirement = "none" | "account" | "oauth" | "api_key";
export type PermissionRequirement = "none" | "user_approval" | "special_permission";

/** Describes authority needed to use a provider. It never contains credentials. */
export interface AuthorizationRequirement {
  id: string;
  providerId: string;
  authorizationType: AuthenticationRequirement | "delegated" | "custom";
  scopes?: string[];
  permissions?: string[];
  userApprovalRequired: boolean;
  metadata?: Record<string, unknown>;
}

/** Records granted authority by reference; raw passwords, tokens, and keys are forbidden here. */
export interface AuthorizationGrant {
  id: string;
  requirementId: string;
  providerId: string;
  status: "granted" | "revoked" | "expired";
  grantedScopes?: string[];
  grantedPermissions?: string[];
  credentialReference?: string;
  grantedAt: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface AccessRequirementDetail {
  authentication?: AuthenticationRequirement;
  permission?: PermissionRequirement;
  /** Credential type names or references only; never raw credential values. */
  credentials?: string[];
  message?: string;
}
