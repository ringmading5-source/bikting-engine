import { UserIntent } from "./intent.types";

export interface IntentRequirements {
  operations: string[];
  desiredOutputs: string[];
  constraints: UserIntent["constraints"];
}

/** Extracts requirements from structured intent fields; it never matches natural-language phrases. */
export function resolveIntent(intent: UserIntent): IntentRequirements {
  return {
    operations: [...new Set(intent.actions ?? [])],
    desiredOutputs: [...new Set(intent.desiredOutputs ?? [])],
    constraints: intent.constraints ?? [],
  };
}
