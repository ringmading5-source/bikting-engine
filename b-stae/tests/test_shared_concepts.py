import tempfile
import unittest
from pathlib import Path
from engine import Engine
from app import Application
from bstae import Model
from shared_concept_demo import train,run,image,audio

class ConceptTests(unittest.TestCase):
    def test_unseen_alignment_and_rejection(self):
        r=run()
        self.assertEqual((r['correct'],r['total'],r['inference_writes']),(3,3,0))
        self.assertEqual(r['unknown']['status'],'unknown')
        self.assertEqual(r['mismatch']['status'],'mismatch')
        e=Engine(database=':memory:')
        try:
            train(e)
            self.assertEqual(e.shared_concepts.predict(audio(1200))['status'],'unknown')
            self.assertEqual(e.shared_concepts.predict({'image':{'width':1,'height':1,'rgb_hex':'ffff00'}})['status'],'unknown')
            observed={row[0] for row in e.db.execute('SELECT value FROM shared_concept_examples')}
            from pattern_memory import encoded
            for value in ['red surface',image(0,235,size=5),audio(300,9500,.8,length=400)]:
                self.assertNotIn(encoded(value),observed)
                self.assertEqual(e.shared_concepts.predict(value)['concept'],'red')
        finally:e.close()
    def test_duplicates_conflict_and_context(self):
        e=Engine(database=':memory:')
        try:
            c=e.shared_concepts
            for _ in range(3):c.observe('a','same word','synthetic','isolated')
            self.assertEqual(c.predict('same word','isolated')['status'],'unknown')
            c.observe('b','same word','contradiction','isolated')
            self.assertEqual(c.predict('same word','isolated')['status'],'contested')
            self.assertEqual(c.predict('same word')['status'],'unknown')
        finally:e.close()
    def test_ambiguity_and_silence(self):
        e=Engine(database=':memory:')
        try:
            c=e.shared_concepts
            for label in ('a','b'):
                for value in ('shared patch','shared tile','shared square'):c.observe(label,value,'synthetic')
            self.assertEqual(c.predict('shared surface')['status'],'ambiguous')
            with self.assertRaises(ValueError):c.predict({'audio':{'samples':[0]*64,'sample_rate':8000}})
            for bad in ['',{'image':{'width':0,'height':1,'rgb_hex':''}}, {'audio':{'samples':[1]*10,'sample_rate':8000}}]:
                with self.assertRaises(ValueError):c.predict(bad)
        finally:e.close()
    def test_sdk_checkpoint_and_api(self):
        with tempfile.TemporaryDirectory() as d:
            with Model() as model:
                train(model.components)
                self.assertEqual(model.request('shared_concept_predict',value='green surface')['concept'],'green')
                model.save(Path(d)/'checkpoint')
            with Model.load(Path(d)/'checkpoint') as model:
                r=model.request('shared_concept_inspect',values=['blue surface',image(2,235),audio(900,9500,.8,400)])
                self.assertEqual((r['status'],r['concept']),('aligned','blue'))
    def test_limits(self):
        e=Engine(database=':memory:')
        try:
            c=e.shared_concepts
            for i in range(513):c.observe('x',f'text {i}','synthetic')
            self.assertEqual(c.predict('text new')['status'],'bounded')
        finally:e.close()
