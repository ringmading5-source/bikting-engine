import { KnowledgeModule } from "../../src/knowledge/knowledge.types";

export const electricityModule: KnowledgeModule = {
  id: "knowledge.electricity",
  name: "Electricity",
  domain: "physics",
  concepts: [
    {
      id: "concept.electric-current",
      kind: "concept",
      name: "Electric Current",
      content: {
        definition: "The flow of electric charge through a conductor.",
      },
    },
    {
      id: "concept.magnetic-field",
      kind: "concept",
      name: "Magnetic Field",
      content: {
        definition: "A region where magnetic forces can act.",
      },
    },
    {
      id: "concept.motor",
      kind: "concept",
      name: "Electric Motor",
      content: {
        definition: "A device that converts electrical energy into mechanical motion.",
        prerequisites: ["concept.electric-current", "concept.magnetic-field"],
      },
    },
  ],
  relationships: [
    {
      id: "rel.current-produces-field",
      type: "produces",
      from: "concept.electric-current",
      to: "concept.magnetic-field",
    },
    {
      id: "rel.field-enables-motor",
      type: "enables",
      from: "concept.magnetic-field",
      to: "concept.motor",
    },
  ],
  sequences: [
    {
      id: "sequence.motor-basics",
      steps: [
        { conceptId: "concept.electric-current", order: 1 },
        { conceptId: "concept.magnetic-field", order: 2 },
        { conceptId: "concept.motor", order: 3 },
      ],
    },
  ],
};
