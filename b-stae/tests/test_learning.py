import json
import unittest
from engine import Engine
from core import *
from knowledge import parse_source

class LearningTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:')
    def tearDown(self):self.e.close()
    def source(self,pairs,validation):
        def encode(items):return [{'before':a.encode().hex(),'after':b.encode().hex()} for a,b in items]
        sid=self.e.knowledge.ingest(parse_source(json.dumps({'training':encode(pairs),'validation':encode(validation)}),'application/json','observations'))
        self.e.encode_source(sid);return sid
    def text(self,a,b):return self.e.recognize(a).state,self.e.recognize(b).state
    def test_learn_unprovided_rule_and_unseen_input(self):
        sid=self.source([self.text('Hi','Hi!'),self.text('Hello','Hello!')],[self.text('Hey','Hey!')])
        result=self.e.learner.learn_source(sid,100)
        self.assertEqual(result['hypotheses'],['append'])
        status,outcome=self.e.learner.predict({25:'New'})
        self.assertEqual(status['status'],'predicted')
        self.assertEqual(decode_outputs(BinaryState.decode(outcome.snapshots[-1]))[25],'New!')
    def test_learn_color_permutation(self):
        def pair(a,b):return self.e.recognize(a).state,self.e.recognize(b).state
        sid=self.source([pair('#010203','#030201'),pair('#040506','#060504')],[pair('#070809','#090807')])
        self.assertEqual(self.e.learner.learn_source(sid,101)['hypotheses'],['block-reorder'])
        status,outcome=self.e.learner.predict({50:'#102030'})
        self.assertEqual(decode_outputs(BinaryState.decode(outcome.snapshots[-1]))[50]['hex'],'#302010')
    def test_heldout_failure_not_registered(self):
        sid=self.source([self.text('Hi','Hi!'),self.text('Hello','Hello!')],[self.text('Hey','Hey?')])
        with self.assertRaises(ValueError):self.e.learner.learn_source(sid,1)
        self.assertFalse(self.e.relationships.load())
    def test_duplicate_validation_rejected(self):
        sid=self.source([self.text('Hi','Hi!'),self.text('Hello','Hello!')],[self.text('Hi','Hi!')])
        with self.assertRaises(ValueError):self.e.learner.learn_source(sid,1)
    def test_unknown_and_ambiguous(self):
        self.assertEqual(self.e.learner.predict({1:'Hi'})[0]['status'],'unknown')
        for rid,suffix in [(1,'!'),(2,'?')]:
            sid=self.source([self.text('Hi','Hi'+suffix),self.text('Hello','Hello'+suffix)],[self.text('Hey','Hey'+suffix)])
            self.e.learner.learn_source(sid,rid)
        self.assertEqual(self.e.learner.predict({1:'New'})[0]['status'],'ambiguous')
    def test_ordinary_observation_source(self):
        from pathlib import Path
        path=Path(__file__).resolve().parents[1]/'examples/color-observations.json'
        sid=self.e.ingest_file(path)
        self.e.learner.learn_source(sid,20)
        self.assertEqual(self.e.learner.predict({9:'#102030'})[0]['status'],'predicted')
    def test_incomplete_binding_search_abstains(self):
        sid=self.source([self.text('Hi','Hi!'),self.text('Hello','Hello!')],[self.text('Hey','Hey!')]);self.e.learner.learn_source(sid,1)
        self.assertEqual(self.e.learner.predict({1:'New',2:'Other'},max_bindings=1)[0]['status'],'bounded')
    def test_unsupported_hypothesis_abstains(self):
        sid=self.source([self.text('one','apple'),self.text('two','banana')],[self.text('three','cherry')])
        with self.assertRaises(ValueError):self.e.learner.learn_source(sid,1)
        self.assertFalse(self.e.relationships.load())
    def test_permissions(self):
        sid=self.source([self.text('Hi','Hi!'),self.text('Hello','Hello!')],[self.text('Hey','Hey!')]);self.e.learner.learn_source(sid,1)
        self.assertEqual(self.e.learner.predict({1:'New'},allowed=frozenset())[0]['status'],'unknown')

if __name__=='__main__':unittest.main()
