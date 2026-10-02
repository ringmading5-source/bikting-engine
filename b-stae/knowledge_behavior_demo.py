"""Synthetic behavior and higher-state composition experiment; no LLM."""
import json
from engine import Engine


def episodes():
    return [[dict(entity=name, phase='start', value=x), dict(entity=name, phase='middle', value=x+5), dict(entity=name, phase='end', value=2*(x+5))] for name, x in [('water', 10), ('metal', 20), ('oil', 40)]]


def concise(result):
    result = json.loads(json.dumps(result))
    for candidate in result.get('candidates', []):
        if 'trajectories' in candidate:
            candidate['matching_paths'] = len(candidate['trajectories'])
            candidate['trajectories'] = candidate['trajectories'][:1]
    return result


def run():
    e = Engine(database=':memory:')
    try:
        b = e.behavior
        learned = b.learn_episodes(episodes(), 'synthetic:state-trajectories', 'chain')
        changes = e.db.total_changes
        checks = []
        for name, x in [('unseen material', 70), ('new object', -10), ('new sample', 101)]:
            state = dict(entity=name, phase='start', value=x)
            one = b.predict(state, 'chain')
            path = b.predict_path(state, 'chain')
            checks.append({'input': state, 'expected_intermediate': x+5, 'expected_final': 2*(x+5),
                           'one_step': concise(one), 'higher_behavior': concise(path),
                           'correct': one['status'] == 'predicted' and one['candidates'][0]['state']['value'] == x+5 and path['status'] == 'predicted' and path['candidates'][0]['state']['value'] == 2*(x+5)})
        writes = e.db.total_changes-changes
        coupling = []
        for name, x, y in [('a', 10, 3), ('b', 20, 8), ('c', 30, 2)]:
            coupling.append(b.observe(dict(entity=name, x=x, y=y), dict(entity=name, x=x+y, y=y), 'synthetic:coupled', 'coupled'))
        coupled_result = b.predict(dict(entity='unseen', x=100, y=7), 'coupled')
        before_conflict = b.inventory('chain')
        start = episodes()[0][0]
        b.observe(start, dict(entity='water', phase='middle', value=99), 'synthetic:counterexample', 'chain')
        return {'scope': 'Finite observed state transformations and learned higher behavior paths; not universal meaning.',
                'training_episodes': episodes(), 'learned': learned, 'models_before_conflict': before_conflict,
                'checks': checks, 'correct': sum(c['correct'] for c in checks), 'total': len(checks),
                'coupling': {'training_updates': coupling, 'prediction': coupled_result,
                             'correct': coupled_result['status'] == 'predicted' and coupled_result['candidates'][0]['state'] == dict(entity='unseen', x=107, y=7)},
                'counterexample': {'single_step': b.predict(start, 'chain'), 'higher_behavior': concise(b.predict_path(dict(entity='new material', phase='start', value=70), 'chain'))},
                'inference_writes': writes, 'llm_calls': 0,
                'limits': 'State boundaries, field types, episode order, and measured/simulated outcomes supplied. Generic affine/binary/sequence operators programmed; specific programs and recurring paths learned. No raw prose extraction or causal verification.'}
    finally:
        e.close()


if __name__ == '__main__':
    print(json.dumps(run(), indent=2, ensure_ascii=False))
