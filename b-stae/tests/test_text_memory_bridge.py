import tempfile
import unittest
from engine import Engine
from text_memory_demo import PLURAL,SINGULAR,evaluate

class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.e=Engine(database=':memory:')
        for batch in (PLURAL,SINGULAR):self.assertEqual(self.e.text_memory.learn(batch,'q')['status'],'learned')
    def tearDown(self):self.e.close()
    def test_roundtrip_unseen(self):
        report=evaluate()
        self.assertEqual(report['correct'],3)
        for case in report['cases']:
            self.assertEqual(case['memory_reasoning']['status'],'predicted')
            self.assertEqual(case['memory_reasoning']['candidates'][0]['record']['multiple'],case['record']['count']>1)
        before=self.e.db.total_changes
        r=self.e.text_memory.parse('three rabbits','q')['candidates'][0]['record']
        self.assertEqual(r,{'entity':'rabbit','count':3})
        self.assertEqual(self.e.text_memory.express(r,'q')['candidates'][0]['text'],'three rabbits')
        self.assertEqual(before,self.e.db.total_changes)
    def test_unknown_quantity_and_shape(self):
        for text in ('five rabbits','three rabbit','three little rabbits'):
            self.assertEqual(self.e.text_memory.parse(text,'q')['status'],'unknown')
        self.assertEqual(self.e.text_memory.express({'entity':'rabbit','count':5},'q')['status'],'unknown')
    def test_conflicting_vocabulary_retained(self):
        self.e.text_memory.learn([{'text':x['text'],'record':dict(x['record'],count=x['record']['count']+10)} for x in PLURAL],'q')
        r=self.e.text_memory.parse('three rabbits','q')
        self.assertEqual(r['status'],'ambiguous')
        self.assertEqual({c['record']['count'] for c in r['candidates']},{3,13})
    def test_renamed_fields(self):
        self.e.text_memory.learn([{'text':x['text'],'record':{'a':x['record']['entity'],'b':x['record']['count']}} for x in PLURAL],'rename')
        self.assertEqual(self.e.text_memory.parse('four goats','rename')['candidates'][0]['record'],{'a':'goat','b':4})
    def test_restart_api(self):
        from app import Application
        with tempfile.TemporaryDirectory() as directory:
            first=Engine(database=directory+'/db');Application(first).dispatch({'action':'text_memory_learn','examples':PLURAL});first.close()
            second=Engine(database=directory+'/db')
            try:
                app=Application(second)
                self.assertEqual(app.dispatch({'action':'text_memory_parse','text':'two goats'})['candidates'][0]['record'],{'entity':'goat','count':2})
                self.assertEqual(app.dispatch({'action':'text_memory_express','record':{'entity':'goat','count':2}})['candidates'][0]['text'],'two goats')
            finally:second.close()
    def test_validation_and_unsupported_retained(self):
        with self.assertRaises(ValueError):self.e.text_memory.learn(PLURAL[:2])
        with self.assertRaises(ValueError):self.e.text_memory.parse('')
        batch=[{'text':text,'record':{'entity':word}} for text,word in [('arbitrary alpha','cat'),('unrelated','dog'),('other longer text','horse')]]
        self.assertEqual(self.e.text_memory.learn(batch,'bad')['status'],'unsupported')
        self.assertEqual(self.e.db.execute('SELECT count(*) FROM bridge_examples').fetchone()[0],9)
