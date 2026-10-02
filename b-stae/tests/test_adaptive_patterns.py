import tempfile
import unittest
from app import Application
from engine import Engine


class AdaptivePatternTests(unittest.TestCase):
    def setUp(self):
        self.e = Engine(database=':memory:')

    def tearDown(self):
        self.e.close()

    def train(self, mode='character'):
        a = self.e.adaptive_patterns
        for subject in ('biology', 'physics', 'history'):
            a.observe('what is '+subject+'?', subject, 'training', mode=mode)
        for word in ('cat', 'dog', 'book'):
            a.observe('plural '+word, word+'s', 'training', mode=mode)

    def test_online_growth_and_unseen_families_in_both_modes(self):
        for mode in ('character', 'byte'):
            a = self.e.adaptive_patterns
            self.assertEqual(a.observe('what is biology?', 'biology', 'training', mode=mode)['status'], 'observed')
            self.assertEqual(a.predict('what is chemistry?', mode=mode)['status'], 'unknown')
            a.observe('what is physics?', 'physics', 'training', mode=mode)
            self.assertEqual(a.predict('what is chemistry?', mode=mode)['status'], 'unknown')
            self.assertEqual(a.observe('what is history?', 'history', 'training', mode=mode)['status'], 'adapted')
            old = {m['model_id'] for m in a.inventory(mode=mode)}
            for word in ('cat', 'dog', 'book'):
                a.observe('plural '+word, word+'s', 'training', mode=mode)
            self.assertTrue(old <= {m['model_id'] for m in a.inventory(mode=mode)})
            changes = self.e.db.total_changes
            for query, expected in [('what is chemistry?', 'chemistry'), ('what is organic chemistry?', 'organic chemistry'), ('plural robot', 'robots'), ('plural café', 'cafés')]:
                r = a.predict(query, mode=mode)
                self.assertEqual(r['status'], 'predicted')
                self.assertEqual([c['text'] for c in r['candidates']], [expected])
            self.assertEqual(a.predict('untrained question', mode=mode)['status'], 'unknown')
            self.assertEqual(changes, self.e.db.total_changes)

    def test_counterexample_is_retained_and_reported(self):
        self.train()
        a = self.e.adaptive_patterns
        a.observe('plural mouse', 'mice', 'exception')
        r = a.predict('plural mouse')
        self.assertEqual(r['status'], 'ambiguous')
        self.assertEqual({c['text'] for c in r['candidates']}, {'mice', 'mouses'})
        self.assertTrue(any(m['evidence']['contradicts'] for m in a.inventory()))
        a.observe('plural mouse', 'mouse creatures', 'conflicting-source')
        self.assertEqual({c['text'] for c in a.predict('plural mouse')['candidates']}, {'mice', 'mouses', 'mouse creatures'})
        self.assertEqual(self.e.db.execute('SELECT count(*) FROM adaptive_examples').fetchone()[0], 8)

    def test_repeated_examples_cannot_create_generalization(self):
        a = self.e.adaptive_patterns
        for _ in range(4):
            a.observe('plural cat', 'cats', 'repeated')
        self.assertEqual(a.inventory(), [])
        self.assertEqual(a.predict('plural dog')['status'], 'unknown')
        self.assertEqual(a.predict('plural cat')['candidates'][0]['text'], 'cats')

    def test_search_budget_retains_evidence(self):
        a = self.e.adaptive_patterns
        a.WINDOW = 2
        for word in ('cat', 'dog', 'book', 'robot'):
            r = a.observe('plural '+word, word+'s', 'training')
        self.assertEqual(r['status'], 'bounded')
        self.assertEqual(a.predict('plural tree')['status'], 'bounded')
        self.assertEqual(self.e.db.execute('SELECT count(*) FROM adaptive_examples').fetchone()[0], 4)

    def test_restart_api_and_validation(self):
        with tempfile.TemporaryDirectory() as folder:
            first = Engine(database=folder+'/db')
            app = Application(first)
            for word in ('cat', 'dog', 'book'):
                app.dispatch(dict(action='adaptive_pattern_observe', before='plural '+word, after=word+'s', source='test'))
            first.close()
            second = Engine(database=folder+'/db')
            try:
                app = Application(second)
                self.assertEqual(app.dispatch(dict(action='adaptive_pattern_predict', text='plural robot'))['candidates'][0]['text'], 'robots')
                self.assertTrue(app.dispatch(dict(action='adaptive_pattern_inventory'))['models'])
            finally:
                second.close()
        a = self.e.adaptive_patterns
        for args in [(None, 'x', 'source'), ('x'*257, 'y', 'source'), ('x', 'y', '')]:
            with self.assertRaises(ValueError):
                a.observe(*args)
        self.assertEqual(self.e.db.execute('SELECT count(*) FROM adaptive_examples').fetchone()[0], 0)
