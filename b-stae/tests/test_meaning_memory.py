import tempfile
import unittest
from engine import Engine
from meaning_demo import train,evaluate,CHANGES

class MeaningTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:');train(self.e)
    def tearDown(self):self.e.close()
    def test_unseen_relations_and_consequences(self):
        self.assertTrue(all(evaluate()['checks'].values()))
        before=self.e.db.total_changes
        for text,n in [('one rabbit',1),('two cafés',2),('three rabbits',3)]:
            r=self.e.meaning_memory.inspect(text,'animals')['readings'][0]
            self.assertEqual(r['predicted_changes'][0]['prediction']['candidates'][0]['record']['count'],n+1)
            self.assertEqual(self.e.meaning_memory.read_field(text,'multiple','animals')['values'],[n>1])
        self.assertEqual(before,self.e.db.total_changes)
    def test_different_action_and_conflict(self):
        subtract=[{'input':x['input'],'output':dict(x['output'],count=x['input']['count']-1)} for x in CHANGES]
        self.e.meaning_memory.learn_changes(subtract,'another-label','animals')
        readings=self.e.meaning_memory.inspect('three rabbits','animals')['readings'][0]
        actions={x['action']:x['prediction'] for x in readings['predicted_changes']}
        self.assertEqual(actions['another-label']['candidates'][0]['record']['count'],2)
        self.e.meaning_memory.learn_changes(subtract,'add-one-observation','animals')
        actions=self.e.meaning_memory.inspect('three rabbits','animals')['readings'][0]['predicted_changes']
        self.assertEqual(actions[0]['prediction']['status'],'ambiguous')
        self.assertEqual({c['record']['count'] for c in actions[0]['prediction']['candidates']},{2,4})
    def test_unknown_context_and_query(self):
        self.assertEqual(self.e.meaning_memory.inspect('three rabbits','other')['status'],'unknown')
        self.assertEqual(self.e.meaning_memory.read_field('three rabbits','color','animals')['status'],'unknown')
        with self.assertRaises(ValueError):self.e.meaning_memory.learn_changes(CHANGES,'')
    def test_restart_api(self):
        from app import Application
        with tempfile.TemporaryDirectory() as folder:
            first=Engine(database=folder+'/db');train(first);first.close();second=Engine(database=folder+'/db')
            try:
                r=Application(second).dispatch({'action':'meaning_read_field','text':'three rabbits','field':'count','context':'animals'})
                self.assertEqual(r['values'],[3])
            finally:second.close()
