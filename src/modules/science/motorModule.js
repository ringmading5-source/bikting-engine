const steps = [
  { focus: 0, title: 'Electrical energy enters', narration: 'An electric motor receives electrical energy from a power source. Current begins to flow through coils of wire.', nodes: ['Electricity', 'Current'], explanation: 'A power source pushes electric charge through wire coils inside the motor. This moving charge is called electric current.' },
  { focus: 1, title: 'Current creates a magnetic field', narration: 'As current flows through the coils, it creates a magnetic field around them. The motor also has fixed magnets.', nodes: ['Current', 'Magnetic field'], explanation: 'Current flowing through a coil creates a magnetic field. Inside the motor, this field interacts with the field of fixed magnets.' },
  { focus: 2, title: 'Magnetic forces push', narration: 'The interacting magnetic fields create forces. Opposite sides of the motor experience forces in different directions.', nodes: ['Magnetic field', 'Force'], explanation: 'The magnetic fields push and pull on each other. The coil is mounted so this force can turn it.' },
  { focus: 3, title: 'The shaft rotates', narration: 'The forces produce torque on the shaft. A commutator or electronic controller keeps the current changing direction at the right time, so the shaft keeps rotating.', nodes: ['Force', 'Rotation'], explanation: 'The push creates torque, turning the shaft. Switching the current at the right moment keeps the turning force going around.' },
  { focus: 4, title: 'Motion does useful work', narration: 'The rotating shaft transfers mechanical energy to a load, such as a fan blade, wheel, or pump.', nodes: ['Rotation', 'Useful work'], explanation: 'The motor converts electrical energy into mechanical motion that can drive a machine or move an object.' },
];

export const motorModule = {
  id: 'science.motor.relationship-model', domain: 'science', version: '1.0.0',
  canHandle: (interpretation) => interpretation.intent === 'electric_motor',
  execute({ interpretation, plan }) {
    const nodes = [
      { id: 'electricity', label: 'Electricity', subtitle: 'energy source' },
      { id: 'current', label: 'Current', subtitle: 'moving charge' },
      { id: 'magnetic-field', label: 'Magnetic field', subtitle: 'coil + fixed magnet' },
      { id: 'force', label: 'Force', subtitle: 'magnetic interaction' },
      { id: 'rotation', label: 'Rotation', subtitle: 'shaft turns' },
      { id: 'work', label: 'Useful work', subtitle: 'mechanical output' },
    ];
    const edges = nodes.slice(0, -1).map((node, index) => ({ from: node.id, to: nodes[index + 1].id, relation: ['drives', 'creates', 'produces', 'turns', 'transfers'][index] }));
    return {
      taskId: plan.taskId, module: this.id,
      title: 'How an electric motor works', summary: 'Electrical energy becomes rotation through current, magnetic fields, and force.',
      explanation: steps.map(({ title, narration, explanation, focus }) => ({ title, narration, text: explanation, focus })),
      visual: { type: 'causal-relationship-graph', renderer: 'svg', nodes, edges, states: steps.map(({ focus, nodes: activeNodes }, index) => ({ id: `step-${index + 1}`, focus, activeNodes: activeNodes.map((label) => nodes.find((node) => node.label === label)?.id).filter(Boolean), explanation: steps[index].title })) },
      narration: { mode: 'step-synchronized', voice: 'browser-speech-synthesis', segments: steps.map(({ narration, focus }, index) => ({ index, text: narration, visualState: `step-${index + 1}`, focus })) },
    };
  },
};
