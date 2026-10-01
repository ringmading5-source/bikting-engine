"""Bounded composition of stored affine transition hypotheses, without LLMs.

Reaching a numeric goal under hypotheses is not verification of real-world action.
Context and relationships are explicit caller-supplied applicability conditions.
"""
from collections import deque
from representation import canonical
from transition_learning import state, gate
from coupled_transition_learning import CoupledTransitionLearning


class LearnedTransitionPlanner:
    def __init__(self, engine):
        self.learner = CoupledTransitionLearning(engine)

    def solve(self, initial, target, model_ids, context, relationships,
              max_depth=4, max_nodes=128, max_frontier=128):
        state(initial); state(target)
        if set(initial) != set(target):
            raise ValueError('initial and target schemas must match')
        gate('planning_environment', context, relationships)
        if not isinstance(model_ids, list) or not 1 <= len(model_ids) <= 16 or any(not isinstance(i, str) for i in model_ids) or len(set(model_ids)) != len(model_ids):
            raise ValueError('1..16 unique explicit model IDs required')
        if any(type(n) is not int for n in (max_depth, max_nodes, max_frontier)) or not 0 <= max_depth <= 8 or not 1 <= max_nodes <= 512 or not 1 <= max_frontier <= 512:
            raise ValueError('invalid search bounds')
        rejected = {}; candidates = []
        def reject(reason): rejected[reason] = rejected.get(reason, 0) + 1
        available = {canonical(r) for r in relationships}
        for ident in sorted(model_ids):
            try: model, active = self.learner.get(ident)
            except ValueError:
                reject('unknown_or_corrupt_model'); continue
            if not active: reject('disabled_model'); continue
            if set(model['coefficients']) != set(initial): reject('schema_mismatch'); continue
            conditions = model['gate']
            if canonical(conditions['context']) != canonical(context): reject('context_mismatch'); continue
            if not {canonical(r) for r in conditions['relationships']} <= available:
                reject('missing_relationship'); continue
            candidates.append((ident, conditions))
        def predict(ident, conditions, value):
            return self.learner.predict(ident, value, conditions['action'], context, conditions['relationships'])
        queue = deque([(dict(initial), [])]); seen = {canonical(initial)}
        expanded = 0; depth_limited = False; found = None
        while queue:
            if expanded >= max_nodes:
                return self.report('bounded', 'node budget exhausted', expanded, rejected)
            value, path = queue.popleft(); expanded += 1
            if canonical(value) == canonical(target): found = path; break
            if len(path) >= max_depth:
                depth_limited = True; continue
            for ident, conditions in candidates:
                try: result = predict(ident, conditions, value)
                except (ValueError, OverflowError):
                    reject('invalid_predicted_state'); continue
                if result['status'] != 'predicted': reject(result['status']); continue
                following = result['state']; key = canonical(following)
                if key in seen: continue
                if len(seen) >= max_nodes or len(queue) >= max_frontier:
                    return self.report('bounded', 'state/frontier budget exhausted', expanded, rejected)
                seen.add(key); queue.append((following, path + [(ident, conditions)]))
        if found is None:
            if not candidates: status, reason = 'knowledge_gap', 'No applicable active learned transitions under supplied conditions.'
            elif depth_limited: status, reason = 'bounded', 'No plan found before the depth limit.'
            else: status, reason = 'unsolved', 'Reachable states exhausted under supplied hypotheses; no claim of impossibility.'
            return self.report(status, reason, expanded, rejected)
        # Replay from the original state through checked evidence, independently
        # of the search snapshots, before reporting goal satisfaction.
        current = dict(initial); trace = []
        for ident, conditions in found:
            result = predict(ident, conditions, current)
            if result['status'] != 'predicted':
                return self.report('invalidated', 'A hypothesis became unavailable during replay.', expanded, rejected)
            trace.append({'model_id': ident, 'action': conditions['action'], 'before': current,
                          'after': result['state'], 'verified_outcome': False})
            current = result['state']
        if canonical(current) != canonical(target):
            return self.report('failed', 'Replay did not satisfy the goal.', expanded, rejected)
        return dict(self.report('goal_satisfied', 'Goal matches after checked hypothesis replay.', expanded, rejected),
                    result=current, goal=target, plan=trace, goal_satisfied=True)

    @staticmethod
    def report(status, reason, expanded, rejected):
        return {'status': status, 'reason': reason, 'expanded': expanded,
                'rejections': rejected, 'model_calls': 0, 'verified_outcome': False,
                'scope': 'bounded numeric planning under learned affine hypotheses; no physical action or observed-world verification'}
