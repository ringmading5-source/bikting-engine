"""Text-described behavior experiment with no supplied semantic field records."""
import json
from engine import Engine


def episodes():
    return [[f'{name}: start {x}', f'{name}: middle {x+5}', f'{name}: end {2*(x+5)}'] for name, x in [('water', 10), ('metal', 20), ('oil', 40)]]


def summary(result):
    result = json.loads(json.dumps(result))
    for candidate in result.get('candidates', []):
        candidate['matching_paths'] = len(candidate.get('trajectories', []))
        candidate['trajectories'] = candidate.get('trajectories', [])[:1]
    return result


def run():
    e = Engine(database=':memory:')
    report = {'training_text': episodes(), 'modes': {},
              'scope': 'Ordered text observations → generic lexical states → learned changes → text descriptions.',
              'limits': 'Trajectory order supplied; integer/text codec programmed; finite behavior operators; no arbitrary prose interpretation or causal verification.'}
    try:
        b = e.text_behavior
        for mode in ('character', 'byte'):
            learned = b.learn(episodes(), 'synthetic:text-trajectory', 'numeric', mode)
            changes = e.db.total_changes
            checks = []
            for subject, x in [('copper', 70), ('new sample', -10), ('猫', 101)]:
                text = f'{subject}: start {x}'
                next_result = b.predict(text, 'numeric', mode)
                path_result = b.predict(text, 'numeric', mode, path=True)
                checks.append({'text': text, 'expected_next': f'{subject}: middle {x+5}', 'expected_final': f'{subject}: end {2*(x+5)}',
                    'next_result': summary(next_result), 'path_result': summary(path_result),
                    'correct': next_result['status'] == path_result['status'] == 'predicted' and [c['text'] for c in next_result['candidates']] == [f'{subject}: middle {x+5}'] and [c['text'] for c in path_result['candidates']] == [f'{subject}: end {2*(x+5)}']})
            writes = e.db.total_changes-changes
            pure = [[f'{name} is asleep.', f'{name} is awake.', f'{name} is walking.'] for name in ('cat', 'dog', 'bird')]
            pure_learned = b.learn(pure, 'synthetic:text-only', 'pure', mode)
            pure_result = b.predict('robot is asleep.', 'pure', mode, path=True)
            b.observe('water: start 10', 'water: middle 99', 'synthetic:counterexample', 'numeric', mode)
            report['modes'][mode] = {'learning': learned, 'checks': checks, 'correct': sum(c['correct'] for c in checks), 'total': len(checks),
                'text_only': {'training': pure, 'learning': pure_learned, 'result': summary(pure_result),
                              'correct': pure_result['status'] == 'predicted' and [c['text'] for c in pure_result['candidates']] == ['robot is walking.']},
                'counterexample': {'next_result': summary(b.predict('water: start 10', 'numeric', mode)),
                                   'path_result': summary(b.predict('copper: start 70', 'numeric', mode, path=True))},
                'inference_writes': writes, 'llm_calls': 0}
        for name, x, y in [('a', 10, 3), ('b', 20, 8), ('c', 30, 2)]:
            b.observe(f'{name}: {x} with {y}', f'{name}: {x+y} with {y}', 'synthetic:coupled', 'coupled')
        coupled = b.predict('new sample: 100 with 7', 'coupled')
        report['cross_measurement'] = {'result': summary(coupled), 'correct': coupled['status'] == 'predicted' and [c['text'] for c in coupled['candidates']] == ['new sample: 107 with 7']}
        return report
    finally:
        e.close()


if __name__ == '__main__':
    print(json.dumps(run(), indent=2, ensure_ascii=False))
