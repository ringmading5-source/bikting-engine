import { Capability } from "../../src/capabilities/capability.types";

export const webSearch: Capability = {
  id: "capability.web-search",
  kind: "capability",
  name: "Web Search",
  description: "Search the public web for current information.",
  inputs: [
    {
      name: "query",
      type: "string",
      required: true,
    },
  ],
  outputs: [
    {
      name: "results",
      type: "search_results",
    },
  ],
  operations: ["search"],
  verificationMethod: "results are present and match the submitted query",
  access: {
    requirement: "free",
  },
};
