import unittest
from engine import Engine
from app import Application

def data():return {'training':[{'before':3,'after':5},{'before':7,'after':9}],'validation':[{'before':11,'after':13}]}
class IntentTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:')
    def tearDown(self):self.e.close()
    def test_registered_no_dataset(self):
        cases=[(100,'add 2',102),('Hi','append "!"','Hi!'),({'position':[1,2,3]},'move by 2,0,-1',[3,2,2]),('#102030','brighten 2',{'rgb':[18,34,50],'hex':'#122232'}),({'audio':{'samples':[10,20],'sample_rate':8000}},'shift samples by 1',[11,21])]
        for value,intent,expected in cases:
            result=self.e.intents.execute(value,intent);self.assertEqual(result['decoded'],expected);self.assertTrue(result['verified'])
    def test_memory_composition_and_cache(self):
        model=self.e.modalities.observe(data())['model']
        result=self.e.intents.execute(100,'add 4')
        self.assertEqual(result['source'],'memory_search');self.assertEqual(len(result['trace']),2)
        self.assertEqual(result['trace'][0]['program'],model)
        self.assertEqual(self.e.intents.execute(100,'add 4')['source'],'persistent_memory')
    def test_depth_and_wrong_outcome(self):
        self.e.modalities.observe(data())
        self.assertEqual(self.e.intents.execute(100,'add 4',max_depth=1)['source'],'registered_operation')
        self.assertEqual(self.e.intents.execute(100,'add 3')['decoded'],103)
    def test_rejection(self):
        for value,intent in [('Hi','add 2'),(3,'teach biology'),(2**63-1,'add 1'),('#ffffff','brighten 1')]:
            with self.assertRaises((ValueError,OverflowError)):self.e.intents.execute(value,intent)
        with self.assertRaises(ValueError):self.e.intents.execute(3,'add 2',max_depth=0)
    def test_image_intent(self):
        result=Application(self.e).dispatch({'action':'image_intent','image':{'width':1,'height':1,'rgb_hex':'102030'},'intent':'brighten 10'})
        self.assertEqual(result['image']['rgb_hex'],'1a2a3a');self.assertTrue(result['verified'])
        with self.assertRaises(ValueError):self.e.intents.image({'width':1,'height':1,'rgb_hex':'ffffff'},'brighten 1')
    def test_api_structured(self):
        result=Application(self.e).dispatch({'action':'intent_execute','value':3,'intent':{'operation':'add','amount':2}})
        self.assertEqual(result['decoded'],5)
    def test_bad_cache_reverified(self):
        self.e.intents.execute(3,'add 2');self.e.db.execute("UPDATE intent_paths SET programs='[]'")
        self.assertEqual(self.e.intents.execute(3,'add 2')['decoded'],5)
