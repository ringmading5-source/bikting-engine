/** Run a plan's steps in dependency order, preserving each result in shared context. */
export async function executeDependencies(steps, executeStep) {
  const pending = new Map(steps.map((step) => [step.id, step]));
  const completed = new Map();
  while (pending.size) {
    const ready = [...pending.values()].filter((step) => (step.dependsOn ?? []).every((dependency) => completed.has(dependency)));
    if (!ready.length) {
      const unresolved = [...pending.keys()].join(', ');
      throw new Error(`Execution plan contains a dependency cycle or missing dependency: ${unresolved}`);
    }
    for (const step of ready) {
      const blockedBy = (step.dependsOn ?? []).find((dependency) => ['error', 'unavailable', 'blocked', 'planned'].includes(completed.get(dependency)?.status));
      const result = blockedBy ? { status: 'blocked', error: `Dependency failed: ${blockedBy}`, stepId: step.id } : await executeStep(step);
      completed.set(step.id, result);
      pending.delete(step.id);
    }
  }
  return [...completed.values()];
}
