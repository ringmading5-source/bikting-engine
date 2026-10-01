"""Disjoint synthetic tests of multiple learned affine behaviors and composition.

Run python pattern_evaluation.py. Oracles generate observations and score tests;
they are never supplied to the learner or planner as executable procedures.
"""
import json
import random
from engine import Engine
from coupled_transition_learning import CoupledTransitionLearning
from learned_planner import LearnedTransitionPlanner

CONTEXT = {'environment': 'synthetic-pattern-benchmark'}
TRAIN = [(-20, -20), (-20, 20), (20, -20), (20, 20), (0, 0)]
VALIDATION = [(-7, 11), (13, -9)]
# Independent scoring oracles, not candidate rules passed to the learner.
ORACLES = {
    'combine': lambda x, y: (x + y, y),
    'remove': lambda x, y: (x - y, y),
    'scale': lambda x, y: (2 * x, y),
    'exchange': lambda x, y: (y, x),
}


def observation(action, x, y):
    a, b = ORACLES[action](x, y)
    return {'before': {'x': x, 'y': y}, 'after': {'x': a, 'y': b},
            'action': action, 'context': CONTEXT, 'relationships': [],
            'outcome': 'observed', 'source': 'synthetic:multi-pattern-v1'}


def evaluate():
    engine = Engine(database=':memory:')
    cases = []
    def record(category, name, passed, details=None):
        cases.append({'category': category, 'case': name,
                      'passed': bool(passed), 'details': details})
    try:
        learner = CoupledTransitionLearning(engine)
        models = {}
        rng = random.Random(314159)
        used = set(TRAIN + VALIDATION)
        tests = []
        while len(tests) < 25:
            pair = (rng.randrange(-19, 20), rng.randrange(-19, 20))
            if pair not in used:
                used.add(pair)
                tests.append(pair)
        for action in ORACLES:
            result = learner.learn([observation(action, *p) for p in TRAIN],
                                   [observation(action, *p) for p in VALIDATION])
            record('learning', action, result['status'] == 'hypothesis_saved')
            if result['status'] != 'hypothesis_saved':
                continue
            ident = models[action] = result['model_id']
            for x, y in tests:
                item = observation(action, x, y)
                prediction = learner.predict(ident, item['before'], action, CONTEXT, [])
                record('unseen_prediction', f'{action}:{x},{y}',
                       prediction.get('state') == item['after'] and
                       prediction.get('verified_outcome') is False)
            mismatch = learner.predict(ident, {'x': 3, 'y': 4}, action,
                                       {'environment': 'unseen'}, [])
            record('context_rejection', action, mismatch['status'] == 'context_mismatch')
            outside = learner.predict(ident, {'x': 21, 'y': 4}, action, CONTEXT, [])
            record('range_rejection', action, outside['status'] == 'outside_observed_range')
        planner = LearnedTransitionPlanner(engine)
        # No training sequences: only isolated transition observations above.
        ids = [models[a] for a in ('combine', 'remove', 'scale') if a in models]
        initial, target = {'x': 3, 'y': 4}, {'x': 18, 'y': 4}
        plan = planner.solve(initial, target, ids, CONTEXT, [], max_depth=3)
        current = initial
        oracle_matches = True
        for step in plan.get('plan', []):
            x, y = ORACLES[step['action']](current['x'], current['y'])
            current = {'x': x, 'y': y}
            oracle_matches &= current == step['after']
        record('unseen_composition', 'three_step_goal',
               plan['status'] == 'goal_satisfied' and len(plan['plan']) == 3 and
               oracle_matches and current == target, plan)
        shallow = planner.solve(initial, target, ids, CONTEXT, [], max_depth=2)
        record('bounded_search', 'insufficient_depth', shallow['status'] == 'bounded')
        bad = observation('combine', 3, 4)
        bad['after']['x'] = 999
        if 'combine' in models:
            feedback = learner.feedback(models['combine'], bad)
            disabled = learner.predict(models['combine'], bad['before'], 'combine', CONTEXT, [])
            record('contradiction', 'disable_bad_hypothesis',
                   feedback['status'] == 'hypothesis_disabled' and disabled['status'] == 'disabled')
        nonlinear = [observation('combine', *p) for p in TRAIN]
        for item in nonlinear:
            item['after']['x'] = item['before']['x'] * item['before']['y']
        rejected = learner.learn(nonlinear, [observation('combine', *p) for p in VALIDATION])
        record('unsupported_pattern', 'variable_multiplication', rejected['status'] == 'unsupported_pattern')
        summary = {}
        for case in cases:
            row = summary.setdefault(case['category'], {'passed': 0, 'total': 0})
            row['total'] += 1
            row['passed'] += int(case['passed'])
        return {'benchmark': 'bstae-multi-pattern-v1', 'seed': 314159,
                'passed': sum(c['passed'] for c in cases), 'total': len(cases),
                'summary': summary, 'cases': cases, 'model_calls': 0,
                'split': 'Training, validation and test input pairs are disjoint; no composition sequences are trained.',
                'scope': 'Exact affine numeric patterns under explicit action/context labels; no general language or universal intelligence claim.'}
    finally:
        engine.close()


if __name__ == '__main__':
    report = evaluate()
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if report['passed'] == report['total'] else 1)
