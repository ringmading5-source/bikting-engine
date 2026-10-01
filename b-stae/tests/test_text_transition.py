import unittest
from engine import Engine
from coupled_transition_learning import CoupledTransitionLearning
from evaluation import observation
from text_transition import parse,answer
class TextTransitionTests(unittest.TestCase):
    def setUp(self):
        self.e=Engine(database=':memory:');self.t=CoupledTransitionLearning(self.e)
        self.ident=self.t.learn([observation(0,0),observation(20,0),observation(0,20),observation(20,20)],[observation(5,10)])['model_id']
    def tearDown(self):self.e.close()
    def test_wording_and_unseen_numbers(self):
        for text,expected in [('I have seven items and receive nine more. How many now?',16),('I have 11 items and get 3 more.',14),('Current stock is 8 and incoming units are 4. What is the new stock?',12)]:
            result=answer(self.t,self.ident,text)
            self.assertEqual(result['prediction']['state']['stock'],expected);self.assertEqual(result['model_calls'],0)
            self.assertFalse(result['prediction']['verified_outcome'])
    def test_unsupported_does_not_guess(self):
        for text in ['I do not have seven items and receive nine more.','I have 7 items and sell 9 more.','I have 7 boxes and receive 9 items.','I have 7 items and receive 9 more unless damaged.','Why do plants need sunlight?','I have minus seven items and receive nine more.']:
            self.assertEqual(answer(self.t,self.ident,text)['status'],'unsupported')
    def test_number_and_range_bounds(self):
        self.assertEqual(parse('I have twenty-one items and receive nine more.')['state']['stock'],21)
        self.assertEqual(answer(self.t,self.ident,'I have 21 items and receive 9 more.')['status'],'outside_observed_range')
        self.assertEqual(parse('I have twenty eleven items and receive nine more.')['status'],'unsupported')
    def test_context_and_disabled_model(self):
        other=self.t.learn([observation(0,0,2),observation(20,0,2),observation(0,20,2)],[observation(5,10,2)])['model_id']
        self.assertEqual(answer(self.t,other,'I have 7 items and receive 9 more.')['status'],'context_mismatch')
        bad=observation(7,9);bad['after']['stock']=99;self.t.feedback(self.ident,bad)
        self.assertEqual(answer(self.t,self.ident,'I have 7 items and receive 9 more.')['status'],'disabled')
