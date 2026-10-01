import unittest
import tempfile
from engine import Engine
from app import Application

class GoalTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:');self.a=Application(self.e)
    def tearDown(self):self.e.close()
    def test_find_text_composition_from_properties(self):
        self.a.gemini.transport=lambda *args:self.fail('unexpected LLM')
        result=self.a.goals.execute('  hello 🤔  ',{'all':['trimmed','uppercase']})
        self.assertEqual(result['result'],'HELLO 🤔');self.assertEqual(len(result['plan']),2)
        self.assertTrue(result['verified']);self.assertEqual(result['model_calls'],0)
        self.assertEqual(self.a.goals.execute('  hello 🤔  ',{'all':['trimmed','uppercase']})['source'],'reverified_memory')
    def test_sort_without_answer_preserves_duplicates(self):
        result=self.a.dispatch({'action':'goal_execute','value':[3,-2,3,1],'goal':{'all':['sorted_ascending']}})
        self.assertEqual(result['result'],[-2,1,3,3])
        self.assertFalse(self.a.goals.verify([3,1,3],[1,3],{'all':['sorted_ascending']}))
    def test_cross_type_composition_from_goal(self):
        result=self.a.goals.execute([3,-2,3],{'equals':8},[{'operation':'multiply','amount':2}])
        self.assertEqual(result['result'],8)
        self.assertEqual([a['operation'] for a in result['plan']],['series_sum','multiply'])
    def test_content_cannot_be_discarded_to_meet_text_properties(self):
        self.assertFalse(self.a.goals.verify(' hello ','',{'all':['trimmed','uppercase']}))
    def test_noop_and_independent_sum(self):
        self.assertEqual(self.a.goals.execute([1,2],{'all':['sorted_ascending']})['plan'],[])
        self.assertEqual(self.a.goals.execute([3,4],{'all':['sum_of_input']})['result'],7)
    def test_bounds_no_plan_and_conflicts(self):
        self.assertEqual(self.a.goals.execute(' hello ',{'all':['trimmed','uppercase']},max_depth=1)['status'],'bounded')
        self.assertEqual(self.a.goals.execute(' hello ',{'all':['trimmed','uppercase']},max_nodes=1)['status'],'bounded')
        self.assertEqual(self.a.goals.execute(10,{'equals':999})['status'],'unsolved')
        with self.assertRaises(ValueError):self.a.goals.execute('x',{'all':['uppercase','lowercase']})
        self.assertEqual(self.e.db.execute('SELECT COUNT(*) FROM goal_plans').fetchone()[0],0)
    def test_smaller_budget_never_bypassed_by_memory(self):
        self.a.goals.execute(' hello ',{'all':['trimmed','uppercase']})
        self.assertEqual(self.a.goals.execute(' hello ',{'all':['trimmed','uppercase']},max_depth=1)['status'],'bounded')
    def test_restart_and_plan_corruption(self):
        with tempfile.TemporaryDirectory() as directory:
            engine=Engine(database=directory+'/memory.db');app=Application(engine)
            app.goals.execute([3,1],{'all':['sorted_ascending']});engine.close()
            engine=Engine(database=directory+'/memory.db');app=Application(engine)
            self.assertEqual(app.goals.execute([3,1],{'all':['sorted_ascending']})['source'],'reverified_memory')
            engine.db.execute("UPDATE goal_plans SET actions='[]'")
            with self.assertRaises(ValueError):app.goals.execute([3,1],{'all':['sorted_ascending']})
            engine.close()
