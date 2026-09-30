import unittest
from app import Application
from engine import Engine

class AppTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:');self.a=Application(self.e)
    def tearDown(self):self.e.close()
    def test_examples_prediction_feedback(self):
        self.assertEqual(self.a.dispatch({'action':'examples'})['status'],'loaded')
        result=self.a.dispatch({'action':'predict','inputs':'{"1":"New"}'})
        self.assertEqual(result['trace'][-1]['decoded'][1],'New!')
        self.assertEqual(self.a.dispatch({'action':'feedback','token':result['token'],'decision':'accept'})['status'],'recorded')
        with self.assertRaises(ValueError):self.a.dispatch({'action':'feedback','token':result['token'],'decision':'accept'})
        self.assertEqual(self.a.dispatch({'action':'status'})['feedback'],1)
    def test_unknown_no_feedback_token(self):
        result=self.a.dispatch({'action':'predict','inputs':'{"1":3}'})
        self.assertEqual(result['status'],'unknown');self.assertNotIn('token',result)
    def test_failed_training_not_registered(self):
        with self.assertRaises(ValueError):self.a.dispatch({'action':'learn','relationship_id':300,'training':[],'validation':[]})
        self.assertFalse(self.e.relationships.load())
    def test_rejection_records_without_silent_retraining(self):
        self.a.dispatch({'action':'examples'})
        result=self.a.dispatch({'action':'predict','inputs':'{"1":"New"}'})
        self.a.dispatch({'action':'feedback','token':result['token'],'decision':'reject'})
        self.assertEqual(self.e.db.execute('SELECT decision FROM outcome_feedback').fetchone()[0],'reject')
        self.assertIn(200,self.e.relationships.load())

if __name__=='__main__':unittest.main()
