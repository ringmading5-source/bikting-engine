import tempfile
import unittest
from engine import Engine
from internal_state_demo import PAIRS,TESTS

class InternalStateTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:')
    def tearDown(self):self.e.close()
    def test_unseen_multiword_and_unicode_in_both_modes(self):
        for mode in ('character','byte'):
            learned=self.e.internal_states.learn(PAIRS,'rewrite',mode)
            self.assertEqual(learned['status'],'learned')
            self.assertEqual([p['slot'] for p in learned['model']['output'] if 'slot' in p],[1,0])
            before=self.e.db.total_changes
            for text,target in TESTS:
                result=self.e.internal_states.predict(text,'rewrite',mode)
                self.assertEqual(result['status'],'predicted')
                self.assertEqual(result['candidates'][0]['text'],target)
                self.assertEqual(self.e.recursive_patterns.decode(result['candidates'][0]['state'],mode),target)
            self.assertEqual(before,self.e.db.total_changes)
    def test_repeated_anchor_cannot_hide_ambiguity(self):
        self.e.internal_states.learn(PAIRS,'rewrite')
        r=self.e.internal_states.predict('the robot carries books carries maps.','rewrite')
        self.assertEqual(r['status'],'ambiguous');self.assertEqual(len(r['candidates']),2)
        self.assertTrue(any(ev.get('alignment_level')=='base-numbers' for c in r['candidates'] for ev in c['evidence']))
    def test_unknown_form_and_conflicting_model(self):
        self.e.internal_states.learn(PAIRS,'rewrite')
        for text in ('the traveller carried maps.','the traveller carries tea.'):
            self.assertEqual(self.e.internal_states.predict(text,'rewrite')['status'],'unknown')
        contradiction=[dict(e,after=e['before'].replace('carries','holds')) for e in PAIRS]
        self.e.internal_states.learn(contradiction,'rewrite')
        r=self.e.internal_states.predict('the traveller carries maps.','rewrite')
        self.assertEqual(r['status'],'ambiguous')
        self.assertEqual({c['text'] for c in r['candidates']},{'maps are carried by the traveller.','the traveller holds maps.'})
    def test_old_model_keeps_its_hierarchy_version(self):
        first=self.e.internal_states.learn(PAIRS,'rewrite')
        unrelated=[{'before':s,'after':'again '+s,'source':'later'} for s in ('alpha','bravo','delta')]
        self.e.internal_states.learn(unrelated,'rewrite')
        r=self.e.internal_states.predict('the traveller carries maps.','rewrite')
        self.assertIn('maps are carried by the traveller.',{c['text'] for c in r['candidates']})
        self.assertTrue(any(ev.get('hierarchy_run')==first['model']['hierarchy_run'] for c in r['candidates'] for ev in c['evidence']))
    def test_improvement_over_whole_copy_and_scan_parity(self):
        self.assertEqual(self.e.composed_states.learn(PAIRS,'baseline')['status'],'unsupported')
        self.assertEqual(self.e.composed_states.predict(TESTS[0][0],'baseline')['status'],'unknown')
        self.e.internal_states.learn(PAIRS,'rewrite')
        a=self.e.internal_states.predict(TESTS[0][0],'rewrite',strategy='scan')
        b=self.e.internal_states.predict(TESTS[0][0],'rewrite',strategy='indexed')
        self.assertEqual({c['text'] for c in a['candidates']},{c['text'] for c in b['candidates']})
        self.assertEqual(b['status'],'predicted')
    def test_restart_api_and_unsupported_evidence(self):
        from app import Application
        with tempfile.TemporaryDirectory() as folder:
            first=Engine(database=folder+'/db');Application(first).dispatch({'action':'internal_state_learn','examples':PAIRS,'context':'rewrite'});first.close()
            second=Engine(database=folder+'/db')
            try:self.assertEqual(Application(second).dispatch({'action':'internal_state_predict','text':TESTS[0][0],'context':'rewrite'})['candidates'][0]['text'],TESTS[0][1])
            finally:second.close()
        bad=[{'before':a,'after':b,'source':'test'} for a,b in [('cat','alpha'),('dog','beta'),('horse','gamma')]]
        self.assertEqual(self.e.internal_states.learn(bad,'bad')['status'],'unsupported')
        self.assertEqual(self.e.db.execute('SELECT count(*) FROM internal_state_examples').fetchone()[0],3)
        with self.assertRaises(ValueError):self.e.internal_states.learn(PAIRS[:2])
