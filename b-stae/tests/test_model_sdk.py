import tempfile
import unittest
from pathlib import Path
from bstae import Model
from role_learning_demo import TRAIN,HOLDOUT

class SDKTests(unittest.TestCase):
    def test_all_components_and_dispatch(self):
        with Model() as model:
            model.learn_roles(TRAIN[:3],'roles')
            r=model.request('role_parse',text=HOLDOUT[0]['text'],context='roles')
            self.assertEqual(r['candidates'][0]['record'],HOLDOUT[0]['record'])
            model.request('knowledge_behavior_observe',before={'x':1},after={'x':3},source='synthetic')
            self.assertTrue(hasattr(model.components,'recursive_text'))
            self.assertTrue(hasattr(model.components,'modalities'))
    def test_checkpoint_full_memory_isolation_and_lifecycle(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'model.sqlite3'
            with Model() as model:
                model.learn_roles(TRAIN[:3])
                model.observe_relationship({'kind':'capability','subject':'cat','action':'lift','object':'ball','allowed':False,'context':None},'synthetic')
                model.components.text_behavior.learn([['a: start 10','a: middle 15','a: end 30'],['b: start 20','b: middle 25','b: end 50'],['c: start 30','c: middle 35','c: end 70']],'synthetic')
                model.save(path)
                with self.assertRaises(FileExistsError):model.save(path)
            with self.assertRaises(RuntimeError):model.predict('cat lifts ball')
            model.close()
            original=path.read_bytes()
            with Model.load(path) as loaded:
                self.assertEqual(loaded.predict('cat lifts ball')['status'],'conflict')
                r=loaded.request('text_behavior_predict',text='new: start 70')
                self.assertEqual(r['candidates'][0]['text'],'new: middle 75')
                loaded.observe_relationship({'kind':'capability','subject':'cat','action':'lift','object':'ball','allowed':True,'context':None},'synthetic:other')
                self.assertEqual(loaded.predict('cat lifts ball')['status'],'contested')
            self.assertEqual(path.read_bytes(),original)
            with Model.load(path,database=Path(d)/'working.sqlite3') as copy:
                self.assertEqual(copy.predict('cat lifts ball')['status'],'conflict')
            with self.assertRaises(ValueError):Model.load(path,database=path)
    def test_invalid_checkpoint(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'empty.sqlite3'
            import sqlite3
            sqlite3.connect(p).close()
            with self.assertRaises(ValueError):Model.load(p)
            with self.assertRaises(ValueError):Model.load(Path(d)/'missing')
