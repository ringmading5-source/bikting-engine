import tempfile
import os
import unittest
from engine import Engine
from relationship_discovery import apply

class DiscoveryTests(unittest.TestCase):
    def setUp(self): self.engine=Engine(database=':memory:')
    def tearDown(self): self.engine.close()
    def train(self, function, context=None, level='character'):
        for index, text in enumerate(('ab','cde','fghij')):
            units=list(text)
            self.engine.patterns.learn_pair(units,function(units),level,f'train:{index}',context)
        return self.engine.discovery_patterns.discover(level,context)
    def test_unseen_different_lengths(self):
        # These functions are scoring/data-generation oracles, never learner arguments.
        for name, oracle in [('reverse',lambda x:x[::-1]), ('duplicate',lambda x:x+x),
                             ('drop_first',lambda x:x[1:]), ('append_first',lambda x:x+x[:1]),
                             ('rotate',lambda x:x[1:]+x[:1]), ('insert',lambda x:x+['!'])]:
            context={'dataset':name}
            report=self.train(oracle,context)
            self.assertTrue(report['hypotheses'])
            stats=self.engine.patterns.stats()
            for text in ('klmn','opqrst','uvwxyza'):
                units=list(text); result=self.engine.discovery_patterns.predict(units,'character',context)
                matches=[c for c in result['candidates'] if c['units']==oracle(units)]
                self.assertTrue(matches,name)
                self.assertTrue(any(len(h['supporting'])==3 and not h['conflicting'] for h in matches[0]['hypotheses']))
                self.assertFalse(result['verified'])
            self.assertEqual(stats,self.engine.patterns.stats())
    def test_conflicting_evidence_and_context(self):
        self.train(lambda x:x[::-1])
        initial=self.engine.discovery_patterns.inventory('character')
        ids={str(h['program']) for h in initial}
        self.engine.patterns.learn_pair(list('klmn'),list('klmn'),'character','contradiction')
        self.engine.discovery_patterns.discover('character')
        after=self.engine.discovery_patterns.inventory('character')
        self.assertTrue(ids.issubset({str(h['program']) for h in after}))
        self.assertTrue(any(h['conflicting'] and len(h['supporting'])>=3 for h in after))
        self.assertEqual(self.engine.patterns.stats()['examples'],4)
        self.assertEqual(self.engine.discovery_patterns.predict(list('xyz'),'character',{'other':True})['status'],'unknown')
    def test_two_position_shortcut_insufficient(self):
        for text in ('ab','cd'):
            self.engine.patterns.learn_pair(list(text),list(text[::-1]),'character','two only')
        self.engine.discovery_patterns.discover('character')
        self.assertEqual(self.engine.discovery_patterns.predict(list('xyz'),'character')['status'],'unknown')
    def test_all_levels_use_same_language(self):
        for level, inputs in [('byte',[[1,2],[3,4,5]]),('word',[['cat','milk'],['dog','water','bowl']]),('sentence',[['A.','B.'],['C.','D.','E.']])]:
            for units in inputs:self.engine.patterns.learn_pair(units,units[::-1],level,'train')
            self.engine.discovery_patterns.discover(level)
            unseen=[10,20,30,40] if level=='byte' else ['new','unseen','units','here']
            result=self.engine.discovery_patterns.predict(unseen,level)
            self.assertTrue(any(c['units']==unseen[::-1] for c in result['candidates']))
    def test_restart_and_bounds(self):
        self.train(lambda x:x[::-1])
        for value in (0,5000,True):
            with self.assertRaises(ValueError):self.engine.discovery_patterns.discover('character',max_programs=value)
        bounded=self.engine.discovery_patterns.discover('character',max_programs=1)
        self.assertTrue(bounded['search_limited'])
        with tempfile.TemporaryDirectory() as folder:
            path=os.path.join(folder,'memory.sqlite')
            first=Engine(database=path)
            for text in ('ab','cde'):first.patterns.learn_pair(list(text),list(text[::-1]),'character','train')
            first.discovery_patterns.discover('character'); inventory=first.discovery_patterns.inventory('character');first.close()
            second=Engine(database=path)
            try:self.assertEqual(second.discovery_patterns.inventory('character'),inventory)
            finally:second.close()
    def test_api(self):
        from app import Application
        self.train(lambda x:x[::-1]);app=Application(self.engine)
        self.assertTrue(app.dispatch({'action':'relationship_discover','level':'character'})['hypotheses'])
        self.assertTrue(app.dispatch({'action':'relationship_inventory','level':'character'})['hypotheses'])
        self.assertTrue(app.dispatch({'action':'relationship_predict','units':list('xyz'),'level':'character'})['candidates'])
