import { createDefaultIntentRules, type IntentRoute } from './intent-router';
import { runLocalCalculation } from './local-calculation';
import { previewIntent, runWebsiteFromIntent } from './canonical-preview';
import { searchPublicKnowledge } from '../knowledge/public-web-search';
import type { ExecutionEvent } from '../execution/events';

export type GoalAnswers = { websiteScope?: 'starter' | 'existing' };
export interface GoalSuggestion { inferredGoal: string; category: 'calculate' | 'website' | 'learn' | 'unknown'; question: string; usage?: { promptTokens: number; candidateTokens: number; totalTokens: number } }
export interface GoalClarifier { suggest(goal: string): Promise<GoalSuggestion> }
export type GoalDecision =
  | { status: 'ready'; goal: string; route: IntentRoute; desiredResult: string; modelCalls: number }
  | { status: 'needs_input'; goal: string; question: string; choices: { id: string; label: string }[]; modelCalls: number }
  | { status: 'needs_confirmation'; goal: string; suggestion: GoalSuggestion; question: string; modelCalls: number; usage?: GoalSuggestion['usage'] }
  | { status: 'unavailable'; goal: string; reason: string; modelCalls: number };

/** Single question-to-result boundary: local intent first, model clarification only for unknown language. */
export class GoalEngine {
  constructor(private readonly clarifier?: GoalClarifier) {}

  async analyze(goal: string, answers: GoalAnswers = {}): Promise<GoalDecision> {
    if (typeof goal !== 'string' || !goal.trim() || goal.length > 4000) throw new TypeError('Enter a goal between 1 and 4000 characters.');
    const normalized = goal.trim();
    if (/\b(personal\s+)?website\b/i.test(normalized) && /\b(build|create|make|edit|change|update)\b/i.test(normalized)) {
      if (!answers.websiteScope) return { status: 'needs_input', goal: normalized, question: 'Do you want a new starter website or changes to an existing project?', choices: [{ id: 'starter', label: 'New starter' }, { id: 'existing', label: 'Existing project' }], modelCalls: 0 };
      if (answers.websiteScope === 'existing') return { status: 'unavailable', goal: normalized, reason: 'Project file access and editing are not installed yet.', modelCalls: 0 };
      if (!/^(?:build|create|make)(?: for me)? my personal website[.!?]?$/i.test(normalized)) return { status: 'unavailable', goal: normalized, reason: 'The starter currently supports the personal website request only.', modelCalls: 0 };
    }
    const route = createDefaultIntentRules().resolve(normalized);
    if (route) {
      const desiredResult = route.id === 'arithmetic' ? 'A verified numeric result' : route.id === 'personal-website' ? 'Three validated website starter files' : 'Linked public sources, without a claimed verified lesson';
      return { status: 'ready', goal: normalized, route, desiredResult, modelCalls: 0 };
    }
    if (!this.clarifier) return { status: 'unavailable', goal: normalized, reason: 'No local intent rule matches. A model clarifier is not configured.', modelCalls: 0 };
    const suggestion = await this.clarifier.suggest(normalized);
    if (!suggestion || !['calculate', 'website', 'learn', 'unknown'].includes(suggestion.category) || typeof suggestion.inferredGoal !== 'string' || !suggestion.inferredGoal.trim() || suggestion.inferredGoal.length > 4000 || typeof suggestion.question !== 'string' || suggestion.question.length > 500) throw new Error('Intent clarifier returned an invalid suggestion.');
    return { status: 'needs_confirmation', goal: normalized, suggestion, question: suggestion.question || `Did you mean: ${suggestion.inferredGoal}?`, modelCalls: 1, usage: suggestion.usage };
  }

  /** Re-analyze at execution, require explicit caller action, and never use an unconfirmed model suggestion. */
  async run(goal: string, answers: GoalAnswers = {}, onEvent?: (event: { type: string; detail: string }) => void) {
    // Execution never spends a second model call on an unconfirmed suggestion.
    const decision = await new GoalEngine().analyze(goal, answers);
    if (decision.status !== 'ready') throw new Error('Resolve the intent question before execution.');
    const { route } = decision;
    const send = (event: ExecutionEvent) => onEvent?.({ type: event.type, detail: event.providerId ?? event.taskId ?? '' });
    if (route.id === 'arithmetic') {
      const result = await runLocalCalculation(route.inputs.expression, send);
      return { status: 'verified' as const, capabilityId: route.capabilityId, result, modelCalls: 0 };
    }
    if (route.id === 'personal-website') {
      const preview = await previewIntent(goal);
      if (!preview.plan || preview.plan.status !== 'ready') throw new Error('Website plan is not ready.');
      const result = await runWebsiteFromIntent(goal, preview.plan.id, send);
      return { status: 'verified' as const, capabilityId: route.capabilityId, result, modelCalls: 0 };
    }
    onEvent?.({ type: 'knowledge_retrieval_started', detail: 'Public knowledge source' });
    const result = await searchPublicKnowledge(route.inputs.topic);
    onEvent?.({ type: 'knowledge_retrieval_completed', detail: `${result.results.length} source links` });
    return { status: 'sources_found' as const, capabilityId: route.capabilityId, result, modelCalls: 0 };
  }
}
