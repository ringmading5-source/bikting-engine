const matches = (state, required) => Object.entries(required).every(([key, value]) => Object.hasOwn(state, key) && state[key] === value);

/** Plans are predictions. Only the trusted observer advances working state. */
export function createTaskAgent({ memory, tools, observe, onVerified = async () => {}, escalate = null }) {
  return {
    async run({ goals, context = {}, maxSteps = 8 }) {
      if (!goals || typeof goals !== 'object' || Array.isArray(goals) || !Object.keys(goals).length || !Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 16) throw new TypeError('Invalid agent request.');
      const trace = [];
      let state = await observe();
      for (let count = 0; count <= maxSteps; count++) {
        if (matches(state, goals)) return { status: 'completed', verification: 'observed', state, trace, modelCalls: 0 };
        if (count === maxSteps) return { status: 'budget_exhausted', state, trace, modelCalls: 0 };
        const plan = await memory.plan({ state, goals, context });
        if (plan.status !== 'planned' || !plan.steps.length) {
          // Escalation supplies a proposal for review, never an executable command.
          const proposal = escalate ? await escalate({ state: structuredClone(state), goals, context, reason: plan.status }) : null;
          return { status: 'needs_knowledge', state, trace, proposal, modelCalls: proposal?.modelCalls ?? 0 };
        }
        const step = plan.steps[0];
        const tool = tools.get(step.tool);
        if (!tool) return { status: 'blocked', reason: 'Procedure has no registered executor.', procedure: step.id, state, trace, modelCalls: 0 };
        const before = await observe();
        if (!matches(before, step.preconditions)) { state = before; trace.push({ procedure: step.id, status: 'preconditions_changed' }); continue; }
        let result;
        try { result = await tool.execute(); }
        catch (error) { return { status: 'failed', reason: error.message, state: await observe(), trace: [...trace, { procedure: step.id, status: 'failed' }], modelCalls: 0 }; }
        state = await observe();
        const verified = matches(state, step.effects);
        trace.push({ procedure: step.id, tool: step.tool, status: verified ? 'verified' : 'failed_verification', result, observedState: structuredClone(state) });
        if (!verified) return { status: 'failed_verification', state, trace, modelCalls: 0 };
        await onVerified({ procedure: step.id, source: step.source, before, observedState: state });
      }
    },
  };
}
