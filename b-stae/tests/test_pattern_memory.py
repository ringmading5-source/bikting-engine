import os
import tempfile
import unittest
from engine import Engine

class PatternMemoryTests(unittest.TestCase):
    def setUp(self):
        self.engine = Engine(database=':memory:')
        self.memory = self.engine.patterns
    def tearDown(self):
        self.engine.close()
    def test_every_span_retained(self):
        units = list('ababa')
        self.memory.observe(units, 'character', 'first')
        for start in range(len(units)):
            for end in range(start+1, len(units)+1):
                self.assertTrue(any(h['start']==start and h['end']==end for h in self.memory.find(units[start:end], 'character')))
        self.memory.observe(list('different'), 'character', 'second')
        self.assertEqual(len(self.memory.find(list('aba'), 'character')), 2)
        self.assertEqual(self.memory.stats()['stored_units'], 14)
    def test_linked_unicode_levels(self):
        result = self.memory.observe_text('猫 drinks milk.', 'unicode')
        for level, pattern in [('byte', list('猫'.encode())), ('character', ['猫']), ('word', ['drinks', 'milk']), ('sentence', ['猫 drinks milk.'])]:
            self.assertEqual(self.memory.find(pattern, level)[0]['observation'], result['observation'])
    def test_unseen_at_four_levels(self):
        for level, train, unseen in [('byte',[1,2],[8,9]), ('character',['a','b'],['x','y']), ('word',['cat','milk'],['dog','water']), ('sentence',['First.','Second.'],['New.','Other.'])]:
            self.memory.learn_pair(train, train+train[:1], level, 'train')
            stats = self.memory.stats()
            result = self.memory.predict(unseen, level)
            self.assertEqual(result['status'], 'predicted')
            self.assertEqual(result['candidates'][0]['units'], unseen+unseen[:1])
            self.assertFalse(result['verified'])
            self.assertEqual(stats, self.memory.stats())
    def test_conflicts_remain(self):
        self.memory.learn_pair(['a','b'], ['a','b','a'], 'word', 'one')
        self.memory.learn_pair(['c','d'], ['d','c'], 'word', 'two')
        result = self.memory.predict(['x','y'], 'word')
        self.assertEqual(result['status'], 'ambiguous')
        self.assertEqual(len(result['candidates']), 2)
        self.assertEqual(self.memory.stats()['examples'], 2)
    def test_unseen_prefix(self):
        self.memory.observe(['The','cat','drinks','milk'], 'word', 'one')
        self.memory.observe(['The','child','drinks','water'], 'word', 'two')
        result = self.memory.complete(['The','dog','drinks'], 'word')
        self.assertEqual({x['unit'] for x in result['candidates']}, {'milk','water'})
    def test_context_unknown_and_types(self):
        self.memory.learn_pair([1,2], [2,1], 'byte', 'one', {'task':'swap'})
        for units, level, context in [([3,4],'byte',None), ([3,4],'word',{'task':'swap'}), ([3,3],'byte',{'task':'swap'})]:
            self.assertEqual(self.memory.predict(units,level,context)['status'], 'unknown')
        self.memory.learn_pair(['a'], ['new constant'], 'word', 'two')
        self.assertEqual(self.memory.predict(['b'],'word')['status'],'unknown')
        self.memory.observe([True,1,'1'], 'generic', 'three')
        self.assertEqual(self.memory.find([1],'generic')[0]['start'],1)
        with self.assertRaises(ValueError): self.memory.observe([float('nan')],'generic','bad')
    def test_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            path=os.path.join(folder,'memory.sqlite')
            first=Engine(database=path)
            first.patterns.learn_pair(['a','b'],['b','a'],'word','persisted')
            stats=first.patterns.stats(); first.close()
            second=Engine(database=path)
            try:
                self.assertEqual(second.patterns.stats(),stats)
                self.assertEqual(second.patterns.predict(['x','y'],'word')['candidates'][0]['units'],['y','x'])
            finally: second.close()

class PatternAPITests(unittest.TestCase):
    def test_dispatch_roundtrip(self):
        from app import Application
        engine=Engine(database=':memory:')
        try:
            app=Application(engine)
            app.dispatch({'action':'pattern_observe','text':'The cat drinks milk.','source':'test'})
            self.assertTrue(app.dispatch({'action':'pattern_find','units':['cat'],'level':'word'})['matches'])
            self.assertEqual(app.dispatch({'action':'pattern_complete','units':['dog','drinks'],'level':'word'})['candidates'][0]['unit'],'milk')
            app.dispatch({'action':'pattern_learn_pair','before':['a','b'],'after':['b','a'],'level':'word','source':'test'})
            self.assertEqual(app.dispatch({'action':'pattern_predict','units':['x','y'],'level':'word'})['candidates'][0]['units'],['y','x'])
            self.assertEqual(app.dispatch({'action':'pattern_stats'})['examples'],1)
            with self.assertRaises(ValueError): app.dispatch({'action':'pattern_observe','text':'bad'})
        finally: engine.close()
