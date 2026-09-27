export interface UserIntent {
  rawInput: string;
  goal: string;
  actions?: string[];
  objects?: string[];
  constraints?: Array<{
    type: string;
    value: unknown;
  }>;
  desiredOutputs?: string[];
  context?: Record<string, unknown>;
}
