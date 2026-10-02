"""Reproducible online adaptation experiment. No LLM or external data."""
import json
from engine import Engine


def run():
    report = {'scope': 'Supervised incremental character/byte copying patterns, not general semantics.', 'modes': {}}
    for mode in ('character', 'byte'):
        e = Engine(database=':memory:')
        try:
            a = e.adaptive_patterns
            history = []
            for subject in ('biology', 'physics', 'history'):
                learned = a.observe('what is '+subject+'?', subject, 'synthetic:question', mode=mode)
                history.append({'update': learned, 'unseen_question': a.predict('what is chemistry?', mode=mode)})
            for word in ('cat', 'dog', 'book'):
                history.append({'update': a.observe('plural '+word, word+'s', 'synthetic:plural', mode=mode)})
            queries = [('what is chemistry?', 'chemistry'), ('what is organic chemistry?', 'organic chemistry'),
                       ('plural robot', 'robots'), ('plural café', 'cafés')]
            changes = e.db.total_changes
            checks = []
            for query, expected in queries:
                result = a.predict(query, mode=mode)
                checks.append({'query': query, 'expected': expected, 'result': result,
                               'correct': result['status'] == 'predicted' and [c['text'] for c in result['candidates']] == [expected]})
            writes = e.db.total_changes-changes
            a.observe('plural mouse', 'mice', 'synthetic:exception', mode=mode)
            report['modes'][mode] = {'history': history, 'checks': checks,
                'correct': sum(c['correct'] for c in checks), 'total': len(checks),
                'inference_writes': writes, 'llm_calls': 0,
                'counterexample_result': a.predict('plural mouse', mode=mode),
                'inventory': a.inventory(mode=mode)}
        finally:
            e.close()
    return report


if __name__ == '__main__':
    print(json.dumps(run(), indent=2, ensure_ascii=False))
