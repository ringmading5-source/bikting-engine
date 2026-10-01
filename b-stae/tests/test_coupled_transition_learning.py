import unittest
from engine import Engine
from coupled_transition_learning import CoupledTransitionLearning,solve,Underdetermined,Inconsistent
from evaluation import observation,evaluate

class CoupledTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:');self.t=CoupledTransitionLearning(self.e)
    def tearDown(self):self.e.close()
    def learn(self):return self.t.learn([observation(0,0),observation(20,0),observation(0,20),observation(20,20)],[observation(5,10)])
    def test_cross_field_prediction_and_inverse(self):
        model=self.learn();item=observation(7,9)
        result=self.t.predict(model['model_id'],item['before'],item['action'],item['context'],item['relationships'])
        self.assertEqual(result['state'],{'stock':16,'incoming':9});self.assertTrue(result['inverse_consistent'])
        self.assertEqual(model['coefficients']['stock']['weights']['incoming'],[1,1])
    def test_correlated_inputs_do_not_identify_rule(self):
        self.assertEqual(self.t.learn([observation(0,0),observation(10,10),observation(20,20)],[observation(5,5)])['status'],'insufficient_variation')
    def test_bad_validation_and_leakage(self):
        validation=observation(5,10);validation['after']['stock']=999
        training=[observation(0,0),observation(20,0),observation(0,20)]
        self.assertEqual(self.t.learn(training,[validation])['status'],'validation_failed')
        with self.assertRaises(ValueError):self.t.learn(training,[observation(0,0)])
    def test_feedback_and_context(self):
        ident=self.learn()['model_id'];item=observation(7,9,2)
        self.assertEqual(self.t.feedback(ident,item)['status'],'context_mismatch')
        item=observation(7,9);item['after']['stock']=99
        self.assertEqual(self.t.feedback(ident,item)['status'],'hypothesis_disabled')
    def test_exact_solver(self):
        self.assertEqual(solve([[1,0],[0,1],[1,1]],[3,4,7]),[3,4])
        with self.assertRaises(Inconsistent):solve([[1,0],[0,1],[1,1]],[3,4,8])
        with self.assertRaises(Underdetermined):solve([[1,1],[2,2]],[2,4])
    def test_evaluation_reports_disjoint_synthetic_scope(self):
        result=evaluate()
        self.assertEqual(result['passed'],result['total']);self.assertEqual(result['summary']['held_out_prediction']['total'],40)
        self.assertEqual(result['model_calls'],0)
        self.assertIn('synthetic',result['scope']);self.assertIn('disjoint',result['split'])
