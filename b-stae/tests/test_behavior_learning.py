import unittest
import tempfile
from engine import Engine
from app import Application

def pairs(items):return [{'input':x,'output':y} for x,y in items]

class LearningTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:');self.a=Application(self.e);self.learning=self.a.goals.learning
    def tearDown(self):self.e.close()
    def learn_double(self):return self.learning.learn(pairs([(1,2),(2,4),(3,6)]),pairs([(4,8)]),'test:double')
    def test_heldout_learning_and_unseen_execution(self):
        self.a.gemini.transport=lambda *args:self.fail('LLM call')
        self.assertEqual(self.a.goals.execute(7,{'equals':14})['status'],'unsolved')
        learned=self.learn_double();self.assertEqual(learned['hypothesis'],{'operation':'multiply','amount':2})
        result=self.a.goals.execute(7,{'equals':14})
        self.assertTrue(result['verified']);self.assertEqual(result['model_calls'],0)
    def test_transfer_to_different_input_type_composition(self):
        self.learn_double()
        result=self.a.goals.execute([1,2,4],{'equals':14})
        self.assertEqual(result['result'],14);self.assertEqual([a['operation'] for a in result['plan']],['series_sum','multiply'])
    def test_failed_validation_never_promoted(self):
        result=self.learning.learn(pairs([(1,2),(2,4),(3,6)]),pairs([(4,9)]),'test:bad')
        self.assertEqual(result['status'],'validation_failed');self.assertEqual(self.learning.candidates(),[])
    def test_identity_ambiguous_and_data_leakage_rejected(self):
        result=self.learning.learn(pairs([(1,1),(2,2),(3,3)]),pairs([(4,4)]),'test:identity')
        self.assertEqual(result['status'],'ambiguous')
        with self.assertRaises(ValueError):self.learning.learn(pairs([(1,2),(2,4),(3,6)]),pairs([(1,2)]),'test:leak')
    def test_counterexample_disables_and_invalidates_plan(self):
        learned=self.learn_double();self.a.goals.execute(7,{'equals':14})
        result=self.learning.feedback(learned['hypothesis_id'],{'input':8,'output':17})
        self.assertEqual(result['status'],'hypothesis_disabled')
        self.assertEqual(self.a.goals.execute(7,{'equals':14})['status'],'unsolved')
        self.learn_double();self.assertEqual(self.learning.candidates(),[])
    def test_restart_and_corruption(self):
        with tempfile.TemporaryDirectory() as directory:
            engine=Engine(database=directory+'/db');app=Application(engine)
            app.goals.learning.learn(pairs([(1,2),(2,4),(3,6)]),pairs([(4,8)]),'test:restart');engine.close()
            engine=Engine(database=directory+'/db');app=Application(engine)
            self.assertTrue(app.goals.execute(9,{'equals':18})['verified'])
            engine.db.execute("UPDATE behavior_hypotheses SET payload='{}'")
            with self.assertRaises(ValueError):app.goals.execute(9,{'equals':18})
            engine.close()
