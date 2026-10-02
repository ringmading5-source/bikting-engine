import tempfile
import unittest
from engine import Engine
from app import Application


def episodes():
    return [[f'{name}: start {x}', f'{name}: middle {x+5}', f'{name}: end {2*(x+5)}'] for name, x in [('water', 10), ('metal', 20), ('oil', 40)]]


class TextBehaviorTests(unittest.TestCase):
    def setUp(self):
        self.e = Engine(database=':memory:')

    def tearDown(self):
        self.e.close()

    def test_text_to_change_to_path_without_supplied_roles(self):
        b = self.e.text_behavior
        for mode in ('character', 'byte'):
            learned = b.learn(episodes(), 'synthetic:text', mode=mode)
            self.assertEqual(learned['status'], 'learned')
            self.assertEqual(learned['derived_states'][0][0]['number0'], 10)
            self.assertNotIn('entity', learned['derived_states'][0][0])
            changes = self.e.db.total_changes
            for subject, x in [('copper', 70), ('new sample', -10), ('猫', 101)]:
                text = f'{subject}: start {x}'
                r = b.predict(text, mode=mode)
                self.assertEqual(r['status'], 'predicted')
                self.assertEqual([c['text'] for c in r['candidates']], [f'{subject}: middle {x+5}'])
                p = b.predict(text, mode=mode, path=True)
                self.assertEqual(p['status'], 'predicted')
                self.assertEqual([c['text'] for c in p['candidates']], [f'{subject}: end {2*(x+5)}'])
                self.assertTrue(all(t['texts'][0] == text for c in p['candidates'] for t in c['trajectories']))
            self.assertEqual(changes, self.e.db.total_changes)
            self.assertEqual(b.predict('copper: unknown 70', mode=mode)['status'], 'unknown')

    def test_cross_measurement_relation_from_text(self):
        b = self.e.text_behavior
        for name, x, y in [('a', 10, 3), ('b', 20, 8), ('c', 30, 2)]:
            b.observe(f'{name}: {x} with {y}', f'{name}: {x+y} with {y}', 'synthetic:coupled')
        r = b.predict('new sample: 100 with 7')
        self.assertEqual(r['status'], 'predicted')
        self.assertEqual([c['text'] for c in r['candidates']], ['new sample: 107 with 7'])

    def test_conflicting_text_outcomes_and_higher_path_evidence(self):
        b = self.e.text_behavior
        b.learn(episodes(), 'synthetic')
        b.observe('water: start 10', 'water: middle 99', 'counterexample')
        r = b.predict('water: start 10')
        self.assertEqual(r['status'], 'ambiguous')
        self.assertEqual({c['text'] for c in r['candidates']}, {'water: middle 15', 'water: middle 99'})
        self.assertEqual(b.predict('new: start 70', path=True)['status'], 'contested')
        inventory = b.inventory()
        self.assertEqual(len(inventory['batches']), 2)
        self.assertTrue(any(m['conflicts'] for m in inventory['models']))

    def test_lossless_codec_and_unsupported_forms(self):
        b = self.e.text_behavior
        for text in ['10', 'reading -10.', '0', '猫: 100 with 7', 'decimal 3.5', 'word only', 'quoted "猫" 5']:
            self.assertEqual(b.decode(b.encode(text)), text)
        self.assertNotIn('number0', b.encode('decimal 3.5'))
        for text in ['', 'x'*129, 'x 1 y 2 z 3', '\ud800']:
            with self.assertRaises(ValueError):
                b.encode(text)
        with self.assertRaises(ValueError):
            b.learn([episodes()[0]]*2, 'source')
        with self.assertRaises(ValueError):
            b.predict('copper: start 70', path='yes')
        self.assertEqual(self.e.db.execute('SELECT count(*) FROM text_behavior_batches').fetchone()[0], 0)

    def test_text_only_state_changes_without_numbers_and_restart_api(self):
        ep=[[f'{n} is asleep.', f'{n} is awake.', f'{n} is walking.'] for n in ('cat', 'dog', 'bird')]
        with tempfile.TemporaryDirectory() as folder:
            first = Engine(database=folder+'/db')
            result = Application(first).dispatch(dict(action='text_behavior_learn', episodes=ep, source='synthetic'))
            self.assertEqual(result['behavior']['status'], 'learned')
            first.close()
            second = Engine(database=folder+'/db')
            try:
                r = Application(second).dispatch(dict(action='text_behavior_predict', text='robot is asleep.', path=True))
                self.assertEqual(r['status'], 'predicted')
                self.assertEqual([c['text'] for c in r['candidates']], ['robot is walking.'])
                self.assertTrue(Application(second).dispatch(dict(action='text_behavior_inventory'))['models'])
            finally:
                second.close()
