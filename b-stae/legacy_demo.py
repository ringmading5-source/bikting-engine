from legacy_core import Engine, State, Signature, Transition, Boundary

def make_engine():
    e = Engine()
    for name, n in [('raw', 0), ('prepared', 1), ('finished', 2)]:
        e.register_state(State(name, Signature(n), lambda c, n=n: c.get('stage') == n))
    e.register_action('prepare', lambda c: c.update(stage=1))
    e.register_action('finish', lambda c: c.update(stage=2, output='Verified result'))
    e.register_transition(Transition('01_prepare', 'raw', 'prepared', 'prepare'))
    e.register_transition(Transition('02_finish', 'prepared', 'finished', 'finish', frozenset({'execute'})))
    return e

if __name__ == '__main__':
    engine = make_engine()
    boundary = Boundary('raw', 'finished', 2, frozenset({'execute'}))
    for _ in range(2):
        print(engine.resolve(boundary, {'stage': 0}))
