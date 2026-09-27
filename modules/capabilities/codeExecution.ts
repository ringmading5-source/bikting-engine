import { Capability } from "../../src/capabilities/capability.types";

/** Declaration only: no arbitrary code execution adapter is supplied. */
export const codeExecution: Capability = {
  id: "capability.code-execution",
  kind: "capability",
  name: "Code Execution",
  description: "Run code in an explicitly selected, controlled environment.",
  inputs: [{ name: "source", type: "code", required: true }],
  outputs: [{ name: "result", type: "execution_result" }],
  operations: ["execute_code"],
  environmentRequirements: ["controlled_runtime"],
  access: { requirement: "user_approval", permission: "user_approval" },
  verificationMethod: "controlled runtime reports a successful exit and expected output",
};
