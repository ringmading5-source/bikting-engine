"""Raw-text recursive frame experiment with explicitly held-out completions."""
import json
from engine import Engine

HEAT = ['the stove heats water.', 'the fire heats water.', 'the sun heats water.']
COOL = ['the ice cools water.', 'the wind cools water.', 'the fridge cools water.']


def summarize(result):
    return {k: v for k, v in result.items() if k != 'candidates'} | {'candidate_count': len(result.get('candidates', []))}


def run():
    report = {'scope': 'Raw text → numerical hierarchy → variable-span relationships → structural completion.',
              'limits': 'Synthetic regular sentences; no physical grounding, causal inference, or arbitrary question answering.', 'modes': {}}
    for mode in ('character', 'byte'):
        e = Engine(database=':memory:')
        try:
            r = e.recursive_text
            learned = r.train([dict(text=s, source='synthetic:heat') for s in HEAT], 'thermal', mode)
            changes = e.db.total_changes
            checks = []
            for query, expected in [('the candle <mask> water.', 'heats'), ('the candle heats <mask>.', 'water'), ('the 猫 <mask> water.', 'heats')]:
                completed = query.replace('<mask>', expected)
                assert completed not in HEAT
                result = r.predict(query, 'thermal', mode)
                checks.append({'query': query, 'expected': expected, 'held_out': True,
                               'correct': result['status'] == 'predicted' and [c['text'] for c in result['preferred']] == [expected],
                               'result': summarize(result)})
            writes = e.db.total_changes-changes
            first_inventory = r.inventory('thermal', mode)
            updated = r.train([dict(text=s, source='synthetic:cool') for s in COOL], 'thermal', mode)
            report['modes'][mode] = {'training': learned, 'inventory_before_update': {'coverage': first_inventory['coverage'], 'learned_constituents': first_inventory['learned_constituents'], 'frames': [{k: v for k, v in f.items() if k not in ('bindings', 'pattern')} for f in first_inventory['frames']]},
                'checks': checks, 'correct': sum(c['correct'] for c in checks), 'total': len(checks),
                'inference_writes': writes, 'llm_calls': 0, 'update': updated,
                'conflict': summarize(r.predict('the candle <mask> water.', 'thermal', mode)),
                'semantic_negative_control': {
                    'query': 'the ice heats <mask>.', 'result': summarize(r.predict('the ice heats <mask>.', 'thermal', mode)),
                    'interpretation': 'Structural fit can complete water despite an unsupported heating claim. No physical truth verification.'}}
        finally:
            e.close()
    return report


if __name__ == '__main__':
    print(json.dumps(run(), indent=2, ensure_ascii=False))
