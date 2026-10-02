import tempfile
import unittest
from engine import Engine
from app import Application


def episodes():
    return [[dict(entity=name, phase='start', value=x), dict(entity=name, phase='middle', value=x+5), dict(entity=name, phase='end', value=2*(x+5))] for name, x in [('water', 10), ('metal', 20), ('oil', 40)]]


class KnowledgeBehaviorTests(unittest.TestCase):
    def setUp(self):
        self.e = Engine(database=':memory:')

    def tearDown(self):
        self.e.close()

    def test_learn_changes_and_higher_behavior_on_unseen_entity(self):
        b = self.e.behavior
        self.assertEqual(b.learn_episodes(episodes(), 'synthetic')['status'], 'learned')
        before = self.e.db.total_changes
        state = dict(entity='new material', phase='start', value=70)
        one = b.predict(state)
        self.assertEqual(one['status'], 'predicted')
        self.assertEqual(one['candidates'][0]['state'], dict(entity='new material', phase='middle', value=75))
        path = b.predict_path(state)
        self.assertEqual(path['status'], 'predicted')
        self.assertEqual(path['candidates'][0]['state'], dict(entity='new material', phase='end', value=150))
        self.assertTrue(all(len(t['states']) == 3 for t in path['candidates'][0]['trajectories']))
        self.assertEqual(before, self.e.db.total_changes)
        self.assertEqual(b.predict(dict(entity='new', phase='missing', value=70))['status'], 'unknown')

    def test_cross_field_relationship_learned_without_named_action(self):
        b = self.e.behavior
        for name, t, energy in [('a', 10, 3), ('b', 20, 8), ('c', 30, 2)]:
            b.observe(dict(entity=name, x=t, y=energy), dict(entity=name, x=t+energy, y=energy), 'simulated')
        r = b.predict(dict(entity='unseen', x=100, y=7))
        self.assertEqual(r['status'], 'predicted')
        self.assertEqual(r['candidates'][0]['state'], dict(entity='unseen', x=107, y=7))
        self.assertTrue(any(m['program']['fields']['x']['kind'] == 'add' for m in b.inventory()))

    def test_counterevidence_kept_and_path_contested(self):
        b = self.e.behavior
        b.learn_episodes(episodes(), 'synthetic')
        state = dict(entity='water', phase='start', value=10)
        b.observe(state, dict(entity='water', phase='middle', value=99), 'counterexample')
        r = b.predict(state)
        self.assertEqual(r['status'], 'ambiguous')
        self.assertEqual({c['state']['value'] for c in r['candidates']}, {15, 99})
        self.assertTrue(any(m['conflicts'] for m in b.inventory()))
        r = b.predict_path(dict(entity='new material', phase='start', value=70))
        self.assertEqual(r['status'], 'contested')
        self.assertTrue(any(t['conflicting_observations'] for c in r['candidates'] for t in c['trajectories']))
        self.assertEqual(self.e.db.execute('SELECT count(*) FROM behavior_observations').fetchone()[0], 7)

    def test_no_independent_evidence_or_unsupported_behavior(self):
        b = self.e.behavior
        for _ in range(3):
            b.observe({'x': 1}, {'x': 2}, 'same')
        self.assertEqual(b.inventory(), [])
        self.assertEqual(b.predict({'x': 4})['status'], 'unknown')
        for x, y in [(1, 7), (2, 11), (3, 2)]:
            b.observe({'x': x}, {'x': y}, 'nonlinear', 'other')
        self.assertEqual(b.predict({'x': 4}, 'other')['status'], 'unknown')
        self.assertEqual(len(b.rows('behavior_observations', 'other')), 3)

    def test_restart_api_validation_and_budget(self):
        with tempfile.TemporaryDirectory() as folder:
            first = Engine(database=folder+'/db')
            Application(first).dispatch(dict(action='knowledge_behavior_learn_episodes', episodes=episodes(), source='synthetic'))
            first.close()
            second = Engine(database=folder+'/db')
            try:
                app = Application(second)
                r = app.dispatch(dict(action='knowledge_behavior_predict_path', state=dict(entity='new', phase='start', value=70)))
                self.assertEqual(r['candidates'][0]['state']['value'], 150)
            finally:
                second.close()
        b = self.e.behavior
        with self.assertRaises(ValueError):
            b.observe({'x': True}, {'x': 1}, 'source')
        with self.assertRaises(ValueError):
            b.learn_episodes([episodes()[0]]*2, 'source')
        self.assertEqual(len(b.rows('behavior_observations', None)), 0)
        b.WINDOW = 2
        for x in (1, 2, 3, 4):
            update = b.observe({'x': x}, {'x': x+5}, 'source')
        self.assertEqual(update['status'], 'bounded')
        self.assertEqual(b.predict({'x': 9})['status'], 'bounded')
