export function planTask(interpretation) {
  return {
    taskId: crypto.randomUUID(),
    intent: interpretation.intent,
    domain: interpretation.domain,
    steps: [
      { id: 'select_module', action: 'select_module', description: `Find a capable ${interpretation.domain} module` },
      { id: 'execute', action: 'execute', description: 'Build a structured response and workspace state' },
      { id: 'present', action: 'present', description: 'Present explanation, visual state, and narration cues' },
    ],
    output: ['explanation', 'visual_state', 'narration'],
  };
}
