import unittest
from engine import Engine
from learned_planner import LearnedTransitionPlanner
from learned_planner_demo import train, CONTEXT, RELATIONSHIPS, observation
from coupled_transition_learning import CoupledTransitionLearning

class LearnedPlannerTests(unittest.TestCase):
    def setUp(self):
        self.e=Engine(database=':memory:');self.ids=train(self.e);self.p=LearnedTransitionPlanner(self.e)
    def tearDown(self):self.e.close()
    def solve(self, start=10, incoming=5, outgoing=3, goal=12, **kwargs):
        return self.p.solve({'stock':start,'incoming':incoming,'outgoing':outgoing},
                            {'stock':goal,'incoming':incoming,'outgoing':outgoing},
                            kwargs.pop('model_ids',self.ids),kwargs.pop('context',CONTEXT),
                            kwargs.pop('relationships',RELATIONSHIPS),**kwargs)
    def test_unseen_composition_without_sequence(self):
        result=self.solve()
        self.assertEqual(result['status'],'goal_satisfied');self.assertEqual(len(result['plan']),2)
        self.assertEqual({s['action'] for s in result['plan']},{'receive','sell'})
        self.assertEqual(result['result']['stock'],12);self.assertEqual(result['model_calls'],0)
        self.assertFalse(result['verified_outcome'])
    def test_held_out_combinations(self):
        for stock,incoming,outgoing in [(8,7,2),(11,4,3),(6,9,4),(14,3,5)]:
            result=self.solve(stock,incoming,outgoing,stock+incoming-outgoing)
            self.assertEqual(result['status'],'goal_satisfied');self.assertEqual(len(result['plan']),2)
    def test_depth_and_node_limits(self):
        self.assertEqual(self.solve(max_depth=1)['status'],'bounded')
        self.assertEqual(self.solve(max_nodes=1)['status'],'bounded')
        self.assertEqual(self.solve(max_frontier=1)['status'],'bounded')
    def test_missing_context_and_relationships(self):
        self.assertEqual(self.solve(context={'warehouse':'B'})['status'],'knowledge_gap')
        self.assertEqual(self.solve(relationships=[])['status'],'knowledge_gap')
        self.assertEqual(self.solve(model_ids=['unknown'])['status'],'knowledge_gap')
    def test_feedback_removes_candidate(self):
        learner=CoupledTransitionLearning(self.e)
        bad=observation(7,9,2,'receive');bad['after']['stock']=999
        learner.feedback(self.ids[0],bad)
        result=self.solve();self.assertNotEqual(result['status'],'goal_satisfied')
        self.assertEqual(result['rejections']['disabled_model'],1)
    def test_schema_range_and_noop(self):
        self.assertEqual(self.solve(start=25,goal=27)['status'],'unsolved')
        result=self.solve(goal=10,max_depth=0)
        self.assertEqual(result['status'],'goal_satisfied');self.assertEqual(result['plan'],[])
        with self.assertRaises(ValueError):self.solve(max_depth=True)
