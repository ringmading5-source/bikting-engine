import { Capability } from "../../src/capabilities/capability.types";

export const webApplicationGeneration: Capability = {
  id: "capability.web-application-generation",
  kind: "capability",
  name: "Web Application Generation",
  description: "Generate a structured web application project from a specification.",
  inputs: [{ name: "specification", type: "application_specification", required: true }],
  outputs: [{ name: "project", type: "web_application_project" }],
  operations: ["generate_web_application"],
  requires: ["capability.code-execution"],
  access: { requirement: "user_approval" },
  verificationMethod: "generated project passes its declared build and test checks",
};
