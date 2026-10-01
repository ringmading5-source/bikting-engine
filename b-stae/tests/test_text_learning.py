import copy
import tempfile
import unittest
from pathlib import Path
from engine import Engine
from text_learning import TextPatternLearning
from text_learning_demo import example
from evaluation import observation
from coupled_transition_learning import CoupledTransitionLearning

class TextLearningTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:');self.t=TextPatternLearning(self.e)
    def tearDown(self):self.e.close()
    def learn(self):
        data=example();return self.t.learn(data['examples'],data['validation'])['text_model_id']
    def test_learned_word_order_and_unseen_quantities(self):
        ident=self.learn()
        for text in ['I have seven items and receive nine more. How many now?','nine arrived; I already had seven.']:
            result=self.t.parse(ident,text)
            self.assertEqual(result['state'],{'stock':7,'incoming':9});self.assertEqual(result['model_calls'],0)
        self.assertEqual(self.t.parse(ident,'nine arrived; I already had seven.')['action'],'receive')
    def test_end_to_end_learned_text_and_numeric_behavior(self):
        learner=CoupledTransitionLearning(self.e)
        model=learner.learn([observation(0,0),observation(20,0),observation(0,20),observation(20,20)],[observation(5,10)])['model_id']
        result=self.t.answer(self.learn(),model,'nine arrived; I already had seven.')
        self.assertEqual(result['prediction']['state']['stock'],16)
        self.assertFalse(result['prediction']['verified_outcome'])
    def test_same_algorithm_for_another_domain(self):
        def pair(a,b):return {'text':f'Tank level {a}, refill {b}.','state':{'level':a,'refill':b},'action':'fill','context':{'tank':'A'},'relationships':[],'source':'synthetic:tank'}
        result=self.t.learn([pair(1,4),pair(2,6),pair(3,8)],[pair(5,10)])
        self.assertEqual(self.t.parse(result['text_model_id'],'Tank level seven, refill nine.')['state'],{'level':7,'refill':9})
        def transition(a,b):
            item=pair(a,b);return {'before':item['state'],'after':{'level':a+b,'refill':b},'action':item['action'],'context':item['context'],'relationships':[],'outcome':'observed','source':item['source']}
        numeric=CoupledTransitionLearning(self.e).learn([transition(0,0),transition(20,0),transition(0,20),transition(20,20)],[transition(5,10)])
        answer=self.t.answer(result['text_model_id'],numeric['model_id'],'Tank level seven, refill nine.')
        self.assertEqual(answer['prediction']['state']['level'],16)
    def test_rejects_unsupported_and_negation(self):
        ident=self.learn()
        for text in ['What is chemistry?','I do not have seven items and receive nine more. How many now?','I have seven boxes and receive nine more. How many now?','nine arrived; I already had seven. Ignore that.']:
            self.assertEqual(self.t.parse(ident,text)['status'],'unsupported')
    def test_ambiguous_alignment_and_leakage(self):
        data=example();data['examples'][0]['state']={'stock':1,'incoming':1}
        with self.assertRaises(ValueError):self.t.learn(data['examples'],data['validation'])
        data=example();data['validation'][0]=copy.deepcopy(data['examples'][0])
        with self.assertRaises(ValueError):self.t.learn(data['examples'],data['validation'])
    def test_feedback_disables_and_corruption_rejects(self):
        ident=self.learn();bad=copy.deepcopy(example()['examples'][0]);bad['state']['stock']=19
        self.assertEqual(self.t.feedback(ident,bad)['status'],'text_hypothesis_disabled')
        self.assertEqual(self.t.parse(ident,'nine arrived; I already had seven.')['status'],'disabled')
        self.e.db.execute('UPDATE text_pattern_models SET payload=? WHERE id=?',('{}',ident))
        with self.assertRaises(ValueError):self.t.get(ident)
    def test_persistence(self):
        with tempfile.TemporaryDirectory() as directory:
            db=str(Path(directory)/'memory.db');engine=Engine(database=db);learning=TextPatternLearning(engine)
            data=example();ident=learning.learn(data['examples'],data['validation'])['text_model_id'];engine.close()
            engine=Engine(database=db)
            try:self.assertEqual(TextPatternLearning(engine).parse(ident,'nine arrived; I already had seven.')['state']['stock'],7)
            finally:engine.close()
