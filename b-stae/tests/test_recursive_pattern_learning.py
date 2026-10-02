import json
import tempfile
import unittest
from engine import Engine
from recursive_pattern_demo import TEXTS

class RecursiveTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:')
    def tearDown(self):self.e.close()
    def examples(self):return [{'text':t,'source':'test:raw'} for t in TEXTS]
    def test_discovery_builds_patterns_from_earlier_patterns(self):
        learned=self.e.recursive_patterns.learn(self.examples(),'raw',rounds=32)
        self.assertGreater(learned['maximum_depth'],2)
        self.assertLess(learned['compressed_units'],learned['original_units'])
        inventory=self.e.recursive_patterns.inventory('raw')
        spans={p['readable']:p for p in inventory['patterns']}
        self.assertIn(' carries ',spans);self.assertGreater(spans[' carries ']['depth'],1)
        chosen={p['unit'] for p in inventory['patterns']}
        self.assertTrue(any(any(child in chosen for child in p['pair']) for p in inventory['patterns']))
        self.assertEqual(self.e.db.execute('SELECT count(*) FROM recursive_observations').fetchone()[0],5)
        self.assertGreater(self.e.db.execute('SELECT count(*) FROM recursive_candidates WHERE chosen=0').fetchone()[0],0)
        counts=[x['working_units'] for x in learned['history']]
        self.assertTrue(all(a>b for a,b in zip(counts,counts[1:])))
    def test_unseen_and_unicode_read_only_in_both_modes(self):
        for mode in ('character','byte'):
            self.e.recursive_patterns.learn(self.examples(),'raw',mode,rounds=32)
            before=self.e.db.total_changes
            for text in ('The traveller carries maps.','A café carries 🐇.','A\nB\t猫'):
                result=self.e.recursive_patterns.encode(text,'raw',mode)
                self.assertEqual(self.e.recursive_patterns.decode(result['units'],mode),text)
                self.assertTrue(result['roundtrip_verified'])
            self.assertEqual(before,self.e.db.total_changes)
    def test_duplicate_texts_not_distinct_support(self):
        result=self.e.recursive_patterns.learn([{'text':'abcabc','source':str(i)} for i in range(3)])
        self.assertEqual(result['patterns_discovered'],0)
        self.assertEqual(self.e.db.execute('SELECT count(*) FROM recursive_observations').fetchone()[0],3)
    def test_bounds_and_retained_versions(self):
        first=self.e.recursive_patterns.learn(self.examples(),'raw',rounds=1,max_depth=1)
        second=self.e.recursive_patterns.learn(self.examples(),'raw',rounds=32)
        self.assertEqual(first['stop_reason'],'round_budget')
        self.assertGreater(second['patterns_discovered'],first['patterns_discovered'])
        self.assertEqual(self.e.db.execute('SELECT count(*) FROM recursive_runs').fetchone()[0],2)
        with self.assertRaises(ValueError):self.e.recursive_patterns.learn(self.examples(),rounds=100)
        with self.assertRaises(ValueError):self.e.recursive_patterns.encode('\ud800')
        with self.assertRaises(ValueError):self.e.recursive_patterns.decode([{'literal':0xd800}])
        with self.assertRaises(ValueError):self.e.recursive_patterns.decode([999999])
        self.assertEqual(self.e.recursive_patterns.encode('untrained','unknown')['status'],'unknown')
    def test_incremental_corpus_retains_earlier_patterns(self):
        first=self.e.recursive_patterns.learn(self.examples(),'raw')
        later=[{'text':'A blue bird flies.','source':'later'},{'text':'A blue plane flies.','source':'later'}]
        second=self.e.recursive_patterns.learn(later,'raw',rounds=40)
        self.assertEqual(second['training_observations'],7)
        spans={p['readable'] for p in self.e.recursive_patterns.inventory('raw')['patterns']}
        self.assertIn(' carries ',spans)
        self.assertTrue(any('blue' in (s or '') for s in spans))
        self.assertEqual(self.e.db.execute('SELECT count(*) FROM recursive_observations').fetchone()[0],7)
    def test_restart_api_and_mode_separation(self):
        from app import Application
        with tempfile.TemporaryDirectory() as folder:
            first=Engine(database=folder+'/db');Application(first).dispatch({'action':'recursive_pattern_learn','examples':self.examples(),'context':'raw'});first.close()
            second=Engine(database=folder+'/db')
            try:
                app=Application(second);result=app.dispatch({'action':'recursive_pattern_encode','text':'The traveller carries maps.','context':'raw'})
                self.assertEqual(app.dispatch({'action':'recursive_pattern_decode','units':result['units']})['text'],'The traveller carries maps.')
                with self.assertRaises(ValueError):second.recursive_patterns.decode(result['units'],'byte')
            finally:second.close()
