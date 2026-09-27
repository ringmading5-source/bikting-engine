export type InputBindingSource =
  | { type: "intent"; path: string[] }
  | { type: "context"; path: string[] }
  | { type: "literal"; value: unknown }
  | { type: "step_output"; stepId: string; path: string[] };

export interface PlanInputBinding {
  target: string;
  source: InputBindingSource;
}
