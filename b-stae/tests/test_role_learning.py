import tempfile
import unittest
from engine import Engine
from app import Application
from role_learning_demo import TRAIN,HOLDOUT,run

class RoleTests(unittest.TestCase):
    def test_holdout_conflict(self):
        r=run()
        for level in ('byte','character'):
            v=r['levels'][level]
            self.assertEqual((v['correct'],v['total']),(8,8))
            self.assertEqual(v['evaluation_writes'],0)
            for c in v['cases']:
                self.assertTrue(all(ev['kind']=='induced' for ev in c['result']['candidates'][0]['evidence']))
        self.assertEqual(r['unseen_wording']['status'],'unknown')
        self.assertEqual(r['conflict']['status'],'ambiguous')
    def test_untrained_form_and_leakage(self):
        e=Engine(database=':memory:')
        try:
            e.roles.learn(TRAIN[:3])
            self.assertEqual(e.roles.parse(HOLDOUT[4]['text'])['status'],'unknown')
            with self.assertRaises(ValueError):e.roles.evaluate(TRAIN[:1])
            with self.assertRaises(ValueError):e.roles.learn([{'text':'a','record':{'actor':'a'}}])
        finally:e.close()
    def test_restart_api(self):
        with tempfile.TemporaryDirectory() as d:
            e=Engine(database=d+'/db')
            Application(e).dispatch({'action':'role_learn','examples':TRAIN[:3],'context':'test'})
            e.close();e=Engine(database=d+'/db')
            try:
                r=Application(e).dispatch({'action':'role_parse','text':HOLDOUT[0]['text'],'context':'test'})
                self.assertEqual(r['candidates'][0]['record'],HOLDOUT[0]['record'])
                self.assertEqual(e.roles.parse(HOLDOUT[0]['text'])['status'],'unknown')
            finally:e.close()
