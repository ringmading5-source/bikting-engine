import sqlite3
import tempfile
import unittest
from pathlib import Path
from engine import Engine
from bstae import Model
from claim_learning_demo import train,run,example
from role_learning_demo import TRAIN

class ClaimTests(unittest.TestCase):
    def test_unseen_mode_polarity_and_punctuation(self):
        r=run(per_form=3);self.assertEqual((r['correct'],r['total'],r['inference_writes']),(36,36,0))
        self.assertEqual(r['unsupported']['status'],'unknown')
        checks=r['coherence']
        self.assertEqual(checks['cat speaks English.']['status'],'conflict')
        self.assertEqual(checks['cat does not speak English.']['status'],'supported')
        self.assertEqual(checks['can cat speak English?']['readings'][0]['coherence']['answer'],'no')
        self.assertEqual(checks['does cat not speak English?']['readings'][0]['coherence']['answer'],'yes')
    def test_original_and_question_safety(self):
        e=Engine(database=':memory:')
        try:
            train(e);text='  robot pushes stone.  ';r=e.claims.parse(text)
            self.assertEqual(r['original'],text)
            self.assertEqual(r['normalized'],'robot pushes stone')
            self.assertEqual(r['candidates'][0]['record']['object'],'stone')
            self.assertEqual(e.claims.parse('robot pushes stone?')['status'],'unknown')
            self.assertTrue(r['candidates'][0]['source_evidence'])
            self.assertTrue(all(row['original'].endswith('.') for row in r['candidates'][0]['source_evidence']))
        finally:e.close()
    def test_conflicting_labels(self):
        e=Engine(database=':memory:')
        try:
            train(e)
            pairs=[example(0,a,v,o) for a,v,o in [('cat','push','box'),('dog','lift','cart'),('bird','kick','ball')]]
            for pair in pairs:pair['record']['polarity']=False
            e.claims.learn(pairs,'synthetic:conflict')
            self.assertEqual(e.claims.parse('robot pushes stone.')['status'],'ambiguous')
            self.assertEqual(e.coherence.inspect('robot pushes stone.')['status'],'ambiguous')
        finally:e.close()
    def test_knowledge_uncertainty(self):
        e=Engine(database=':memory:')
        try:
            train(e)
            self.assertEqual(e.coherence.inspect('can cat speak English?')['status'],'unknown')
            assertion={'kind':'capability','subject':'cat','action':'speak','object':'English','allowed':False,'context':None}
            for allowed in (False,True):e.coherence.observe(dict(assertion,allowed=allowed),'synthetic')
            r=e.coherence.inspect('can cat speak English?')
            self.assertEqual(r['status'],'contested')
            self.assertNotIn('answer',r['readings'][0]['coherence'])
        finally:e.close()
    def test_sdk_restart_and_old_checkpoint(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'old'
            with Model() as m:m.learn_roles(TRAIN[:3]);m.save(path)
            with sqlite3.connect(path) as db:
                db.execute('DROP TABLE claim_forms');db.execute('DROP TABLE claim_observations')
            with Model.load(path) as m:
                self.assertEqual(m.predict('cat pushes box')['role_status'],'predicted')
                train(m.components)
                m.observe_relationship({'kind':'capability','subject':'cat','action':'speak','object':'English','allowed':False,'context':None},'synthetic')
                self.assertEqual(m.predict('cat does not speak English.')['status'],'supported')
                m.save(Path(d)/'new')
            with Model.load(Path(d)/'new') as m:
                r=m.request('claim_inspect',text='can cat speak English?')
                self.assertEqual(r['readings'][0]['coherence']['answer'],'no')
    def test_validation(self):
        e=Engine(database=':memory:')
        try:
            pairs=[example(0,a,v,o) for a,v,o in [('cat','push','box'),('dog','lift','cart'),('bird','kick','ball')]]
            for pair in pairs:pair['record']['polarity']=1
            with self.assertRaises(ValueError):e.claims.learn(pairs,'synthetic')
            self.assertEqual(e.db.execute('SELECT count(*) FROM claim_observations').fetchone()[0],0)
        finally:e.close()
