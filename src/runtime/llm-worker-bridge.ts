import { createDefaultIntentRules } from './intent-router';
import { runLocalCalculation } from './local-calculation';
import { previewIntent, runWebsiteFromIntent } from './canonical-preview';

export interface WorkerProposal { kind: 'call'; capabilityId: string; inputs: Record<string, unknown> } 
export interface WorkerFinal { kind: 'final'; summary: string }
export interface WorkerModel { next(context: Readonly<{ goal: string; offeredTools: readonly { capabilityId: string; inputs: readonly string[]; outputs: readonly string[] }[]; observations: readonly WorkerObservation[] }>): Promise<WorkerProposal | WorkerFinal> }
export interface WorkerObservation { capabilityId: string; verified: boolean; output: unknown }
export interface WorkerEvent { type: 'proposal' | 'tool_started' | 'tool_completed' | 'tool_failed' | 'final'; detail: string }

/** The model proposes actions as data. Bikting owns every tool call and the success decision. */
export async function runLlmWorker(goal: string, model: WorkerModel, onEvent?: (event: WorkerEvent) => void) {
  const route = createDefaultIntentRules().resolve(goal);
  if (!route || !['arithmetic', 'personal-website'].includes(route.id)) throw new Error('The worker currently supports numeric arithmetic and the personal website starter only.');
  const offeredTools = route.id === 'arithmetic'
    ? [{ capabilityId: 'math.calculate', inputs: ['expression'], outputs: ['numericResult'] }]
    : [{ capabilityId: 'code.scaffold', inputs: [], outputs: ['files'] }];
  const observations: WorkerObservation[] = [];
  for (let turn = 0; turn < 3; turn++) {
    const proposal = await model.next(structuredClone({ goal, offeredTools, observations }));
    if (!proposal || typeof proposal !== 'object') throw new Error('Worker returned an invalid proposal.');
    if (proposal.kind === 'final') {
      if (!observations.some(({ verified }) => verified)) throw new Error('Worker claimed completion before a verified tool result.');
      if (typeof proposal.summary !== 'string' || !proposal.summary.trim()) throw new Error('Worker final summary is empty.');
      onEvent?.({ type: 'final', detail: 'Verified work complete.' });
      return { status: 'completed' as const, summary: proposal.summary.slice(0, 1000), observations };
    }
    if (proposal.kind !== 'call' || proposal.capabilityId !== route.capabilityId || !proposal.inputs || typeof proposal.inputs !== 'object' || Array.isArray(proposal.inputs)) throw new Error('Worker requested a capability outside the approved task.');
    if (observations.length) throw new Error('Worker requested another tool call after the approved task was verified.');
    onEvent?.({ type: 'proposal', detail: `Requested ${proposal.capabilityId}.` });
    if (route.id === 'arithmetic') {
      if (Object.keys(proposal.inputs).join(',') !== 'expression' || proposal.inputs.expression !== route.inputs.expression) throw new Error('Worker changed the approved arithmetic expression.');
      onEvent?.({ type: 'tool_started', detail: 'Running Bikting calculator.' });
      const result = await runLocalCalculation(route.inputs.expression);
      observations.push({ capabilityId: route.capabilityId, verified: result.verified, output: { numericResult: result.value } });
    } else {
      if (Object.keys(proposal.inputs).length) throw new Error('Website starter accepts no model-supplied inputs.');
      onEvent?.({ type: 'tool_started', detail: 'Running Bikting website scaffold.' });
      const preview = await previewIntent(goal);
      if (!preview.plan || preview.plan.status !== 'ready') throw new Error('Website plan is not ready.');
      const result = await runWebsiteFromIntent(goal, preview.plan.id);
      observations.push({ capabilityId: route.capabilityId, verified: result.validated, output: { fileNames: Object.keys(result.files), files: result.files } });
    }
    onEvent?.({ type: 'tool_completed', detail: `Verified ${proposal.capabilityId}.` });
  }
  throw new Error('Worker exceeded the three-step bound without completing the goal.');
}
