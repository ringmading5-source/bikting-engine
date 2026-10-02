import tempfile
import unittest
from engine import Engine
from composed_state_demo import PLURAL,SENTENCE,REPORT

class ComposedStateTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:')
    def tearDown(self):self.e.close()
    def train(self,mode='character'):
        for context,pairs in [('plural',PLURAL),('sentence',SENTENCE),('report',REPORT)]:
            self.assertEqual(self.e.composed_states.learn(pairs,context,mode)['status'],'learned')
    def test_unseen_composition_both_modes_no_updates(self):
        for mode in ('character','byte'):
            self.train(mode);before=self.e.db.total_changes
            self.assertEqual(self.e.composed_states.predict('rabbit','plural',mode)['candidates'][0]['text'],'rabbits')
            for word in ('rabbit','café','猫'):
                r=self.e.composed_states.compose(word,['sentence','report'],mode)
                self.assertEqual(r['status'],'predicted')
                self.assertEqual(r['candidates'][0]['text'],'Report: The '+word+' sleeps.')
                self.assertEqual(self.e.recursive_patterns.decode(r['candidates'][0]['state'],mode),r['candidates'][0]['text'])
                self.assertEqual(len(r['stages']),2);self.assertFalse(r['executed'])
            self.assertEqual(before,self.e.db.total_changes)
    def test_rules_reuse_hierarchy_nodes(self):
        self.train()
        rules=self.e.composed_states.inventory('sentence')
        states=rules[0]['prefix_state']+rules[0]['suffix_state']
        self.assertTrue(any(type(x) is int and self.e.db.execute('SELECT depth FROM recursive_units WHERE id=?',(x,)).fetchone()[0]>1 for x in states))
        self.assertEqual(len(rules[0]['supporting']),3)
    def test_exceptions_and_conflicts_preserved(self):
        self.train()
        irregular=[{'before':a,'after':b,'source':'exceptions'} for a,b in [('mouse','mice'),('sheep','sheep'),('person','people')]]
        self.assertEqual(self.e.composed_states.learn(irregular,'plural')['status'],'unsupported')
        r=self.e.composed_states.predict('mouse','plural')
        self.assertEqual(r['status'],'ambiguous')
        self.assertEqual({x['text'] for x in r['candidates']},{'mice','mouses'})
        self.assertEqual(len(self.e.composed_states.inventory('plural')[0]['conflicting']),3)
        self.assertEqual(self.e.db.execute('SELECT count(*) FROM composed_examples WHERE context=?',('"plural"',)).fetchone()[0],6)
    def test_bounded_composition_and_unknown(self):
        self.train()
        alternate=[dict(e,after='Notice: '+e['before']) for e in REPORT]
        self.e.composed_states.learn(alternate,'report')
        self.assertEqual(self.e.composed_states.compose('rabbit',['sentence','report'])['status'],'ambiguous')
        self.assertEqual(self.e.composed_states.compose('rabbit',['sentence','report'],max_candidates=1)['status'],'bounded')
        self.assertEqual(self.e.composed_states.compose('rabbit',['missing'])['status'],'unknown')
        with self.assertRaises(ValueError):self.e.composed_states.compose('rabbit',['sentence']*9)
        with self.assertRaises(ValueError):self.e.composed_states.learn(PLURAL[:2])
    def test_restart_api(self):
        from app import Application
        with tempfile.TemporaryDirectory() as folder:
            first=Engine(database=folder+'/db');Application(first).dispatch({'action':'composed_state_learn','examples':PLURAL,'context':'plural'});first.close()
            second=Engine(database=folder+'/db')
            try:self.assertEqual(Application(second).dispatch({'action':'composed_state_predict','text':'rabbit','context':'plural'})['candidates'][0]['text'],'rabbits')
            finally:second.close()
