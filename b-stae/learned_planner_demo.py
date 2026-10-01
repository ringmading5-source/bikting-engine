"""Train receive/sell separately, discover an unseen composition; synthetic data."""
import json
from engine import Engine
from coupled_transition_learning import CoupledTransitionLearning
from learned_planner import LearnedTransitionPlanner

CONTEXT = {'warehouse': 'A'}
RELATIONSHIPS = [{'from': 'incoming', 'kind': 'adds_to', 'to': 'stock'},
                 {'from': 'outgoing', 'kind': 'subtracts_from', 'to': 'stock'}]


def observation(stock, incoming, outgoing, action):
    before = {'stock': stock, 'incoming': incoming, 'outgoing': outgoing}
    after = dict(before)
    after['stock'] += incoming if action == 'receive' else -outgoing
    return {'before': before, 'after': after, 'action': action, 'context': CONTEXT,
            'relationships': [RELATIONSHIPS[0 if action == 'receive' else 1]],
            'outcome': 'observed', 'source': 'synthetic:composition-demo-v1'}


def train(engine):
    learner = CoupledTransitionLearning(engine)
    points = [(0,0,0), (20,0,0), (0,20,0), (0,0,20), (20,20,20)]
    return [learner.learn([observation(*p, action) for p in points],
                         [observation(5,10,2,action)])['model_id']
            for action in ('receive','sell')]


def demo():
    engine = Engine(database=':memory:')
    try:
        ids = train(engine)
        result = LearnedTransitionPlanner(engine).solve(
            {'stock':10, 'incoming':5, 'outgoing':3},
            {'stock':12, 'incoming':5, 'outgoing':3}, ids, CONTEXT, RELATIONSHIPS)
        return dict(result, dataset='synthetic independent transitions; no action sequences supplied in training')
    finally: engine.close()


if __name__ == '__main__': print(json.dumps(demo(), indent=2))
