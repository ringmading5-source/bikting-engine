import { Capability } from "../../src/capabilities/capability.types";

export const calculation: Capability = {
  id: "capability.calculation",
  kind: "capability",
  name: "Calculation",
  description: "Evaluate a structured mathematical expression.",
  inputs: [{ name: "expression", type: "string", required: true }],
  outputs: [{ name: "result", type: "numeric_result" }],
  operations: ["calculate"],
  access: { requirement: "free" },
  verificationMethod: "result is finite and satisfies the submitted expression",
};
