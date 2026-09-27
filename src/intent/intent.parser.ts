import { UserIntent } from "./intent.types";

/** Creates a normalized intent object. Language-model parsing can replace this adapter later. */
export function createIntent(input: Omit<UserIntent, "rawInput"> & { rawInput?: string }): UserIntent {
  if (!input.goal?.trim()) throw new Error("An intent goal is required.");
  return {
    rawInput: input.rawInput ?? input.goal,
    goal: input.goal.trim(),
    actions: [...(input.actions ?? [])],
    objects: [...(input.objects ?? [])],
    constraints: [...(input.constraints ?? [])],
    desiredOutputs: [...(input.desiredOutputs ?? [])],
    context: { ...(input.context ?? {}) },
  };
}
