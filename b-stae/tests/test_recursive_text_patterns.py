import tempfile
import unittest
from app import Application
from engine import Engine


HEAT = ['the stove heats water.', 'the fire heats water.', 'the sun heats water.']
COOL = ['the ice cools water.', 'the wind cools water.', 'the fridge cools water.']


def observations(texts):
    return [dict(text=t, source='synthetic:raw') for t in texts]


class RecursiveTextTests(unittest.TestCase):
    def setUp(self):
        self.e = Engine(database=':memory:')

    def tearDown(self):
        self.e.close()

    def test_raw_hierarchy_transfer_both_modes_without_targets(self):
        for mode in ('character', 'byte'):
            r = self.e.recursive_text
            learned = r.train(observations(HEAT), 'heat', mode)
            self.assertEqual(learned['status'], 'learned')
            self.assertGreater(learned['discovery']['maximum_depth'], 1)
            inventory = r.inventory('heat', mode)
            self.assertEqual(inventory['coverage']['total_base_units'], sum(len(self.e.recursive_patterns.raw(t, mode)) for t in HEAT))
            self.assertTrue(inventory['learned_constituents'])
            self.assertTrue(all(f['readable_structure'] for f in inventory['frames']))
            self.assertTrue(any(any(level.startswith('depth-') for level in f['discovered_levels']) for f in inventory['frames']))
            before = self.e.db.total_changes
            for text, expected in [('the candle <mask> water.', 'heats'), ('the candle heats <mask>.', 'water'), ('the 猫 <mask> water.', 'heats')]:
                result = r.predict(text, 'heat', mode)
                self.assertEqual(result['status'], 'predicted')
                self.assertEqual([c['text'] for c in result['preferred']], [expected])
                self.assertNotIn(result['preferred'][0]['completed'], HEAT)
            self.assertEqual(before, self.e.db.total_changes)

    def test_conflicting_patterns_retained_across_updates(self):
        r = self.e.recursive_text
        first = r.train(observations(HEAT), 'thermal')
        second = r.train(observations(COOL), 'thermal')
        self.assertNotEqual(first['run_id'], second['run_id'])
        self.assertEqual(len(r.inventory('thermal')['observations']), 6)
        result = r.predict('the candle <mask> water.', 'thermal')
        self.assertEqual(result['status'], 'ambiguous')
        self.assertEqual({c['text'] for c in result['preferred']}, {'heats', 'cools'})
        self.assertEqual(self.e.db.execute('SELECT count(*) FROM recursive_text_runs').fetchone()[0], 2)
        self.assertEqual(self.e.db.execute('SELECT count(*) FROM recursive_observations').fetchone()[0], 9)

    def test_repetition_not_enough_and_unknown_context(self):
        r = self.e.recursive_text
        r.train(observations([HEAT[0]]*3))
        self.assertEqual(r.inventory()['frames'], [])
        self.assertEqual(r.predict('the candle <mask> water.')['status'], 'unknown')
        self.assertEqual(r.predict('the candle <mask> water.', 'missing')['status'], 'unknown')

    def test_budget_marks_incomplete_results(self):
        r = self.e.recursive_text
        r.MAX_PAIRS = 1
        learned = r.train(observations(HEAT))
        self.assertEqual(learned['status'], 'bounded')
        self.assertEqual(r.predict('the candle <mask> water.')['status'], 'bounded')
        self.assertEqual(len(r.inventory()['observations']), 3)

    def test_restart_api_unicode_and_validation(self):
        with tempfile.TemporaryDirectory() as folder:
            first = Engine(database=folder+'/db')
            app = Application(first)
            app.dispatch(dict(action='recursive_text_train', observations=observations(['猫 eats rice.', '狗 eats rice.', '鸟 eats rice.']), mode='byte'))
            first.close()
            second = Engine(database=folder+'/db')
            try:
                app = Application(second)
                r = app.dispatch(dict(action='recursive_text_predict', text='马 <mask> rice.', mode='byte'))
                self.assertEqual(r['status'], 'predicted')
                self.assertEqual(r['preferred'][0]['text'], 'eats')
                self.assertTrue(app.dispatch(dict(action='recursive_text_inventory', mode='byte'))['frames'])
            finally:
                second.close()
        r = self.e.recursive_text
        for bad in [observations(HEAT[:1]), [{'text': HEAT[0], 'source': 'x', 'after': 'heat'}]*3, observations(['<mask>', 'abc'])]:
            with self.assertRaises(ValueError):
                r.train(bad)
        with self.assertRaises(ValueError):
            r.predict('no gap')
        self.assertEqual(self.e.db.execute('SELECT count(*) FROM recursive_text_runs').fetchone()[0], 0)
