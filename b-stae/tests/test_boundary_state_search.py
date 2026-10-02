import json
import tempfile
import unittest
from engine import Engine
from boundary_search_benchmark import run
from composed_state_demo import PLURAL

class BoundarySearchTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:')
    def tearDown(self):self.e.close()
    def add(self,text):return self.e.boundary_states.observe(list(map(ord,text)),{'text':text},'test','x')
    def test_boundary_collision_requires_interior_check(self):
        for text in ('cat','cot','cut'):self.add(text)
        r=self.e.boundary_states.search(list(map(ord,'cat')),'x')
        self.assertEqual(r['candidate_states'],3);self.assertEqual(r['rejected_states'],2)
        self.assertEqual([x['payload']['text'] for x in r['matches']],['cat'])
        self.assertTrue(r['matches'][0]['interior_verified'])
    def test_recursive_interior_deep_collision(self):
        self.add('abcdefghijk');self.add('abcdXfghijk')
        r=self.e.boundary_states.search(list(map(ord,'abcdefghijk')),'x')
        self.assertEqual(r['candidate_states'],2);self.assertEqual(len(r['matches']),1)
        self.assertGreater(r['recursive_nodes_visited'],2)
    def test_scan_parity_and_reduced_candidates(self):
        r=run(36,repeats=1)
        self.assertTrue(r['same_answers'])
        self.assertLess(r['strategies']['indexed']['tested_states_per_query_set'],r['strategies']['scan']['tested_states_per_query_set'])
        self.assertEqual(r['collision_check']['status'],'unknown')
    def test_budget_no_false_verification(self):
        self.add('abcdefghijk')
        r=self.e.boundary_states.search(list(map(ord,'abcdefghijk')),'x',max_nodes=1)
        self.assertEqual(r['status'],'bounded');self.assertEqual(r['matches'],[])
        self.add('abcdefghijk')
        self.assertEqual(self.e.boundary_states.search(list(map(ord,'abcdefghijk')),'x',max_candidates=1)['status'],'bounded')
        with self.assertRaises(ValueError):self.e.boundary_states.search([True],'x')
        with self.assertRaises(ValueError):self.e.boundary_states.search([256],mode='byte')
    def test_integration_migration_and_persistence(self):
        self.e.composed_states.learn(PLURAL,'plural');before=self.e.db.total_changes
        for word in ('cat','rabbit'):
            a=self.e.composed_states.predict(word,'plural',strategy='scan')
            b=self.e.composed_states.predict(word,'plural',strategy='indexed')
            self.assertEqual({c['text'] for c in a['candidates']},{c['text'] for c in b['candidates']})
        self.assertEqual(before,self.e.db.total_changes)
        with tempfile.TemporaryDirectory() as folder:
            first=Engine(database=folder+'/db');first.composed_states.learn(PLURAL,'plural')
            first.db.execute('DELETE FROM boundary_states');first.db.commit();first.close()
            second=Engine(database=folder+'/db')
            try:
                r=second.composed_states.predict('cat','plural')
                self.assertEqual(len(r['retrieval']['matches']),1)
                self.assertEqual(r['status'],'predicted')
            finally:second.close()
