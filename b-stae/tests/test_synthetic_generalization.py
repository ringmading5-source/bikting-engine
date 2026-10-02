import tempfile
import unittest
from pathlib import Path
from engine import Engine
from pattern_memory import encoded
from role_learning_demo import TRAIN,HOLDOUT
from synthetic_generalization_benchmark import generate,run

class SyntheticTests(unittest.TestCase):
    def test_deterministic_disjoint_dataset(self):
        train,test=generate(12,12)
        self.assertEqual((train,test),generate(12,12))
        self.assertEqual((len(train),len(test)),(72,48))
        self.assertFalse({x['text'] for x in train}&{x['text'] for x in test})
        self.assertFalse({encoded(x['record']) for x in train}&{encoded(x['record']) for x in test if x['split']=='new_combinations'})
    def test_growth_and_untrained_wording(self):
        with tempfile.TemporaryDirectory() as d:
            r=run(d,stages=(3,18,72),per_form=12,per_split=12)
            self.assertEqual(r['stages'][0]['splits']['new_entities']['accuracy'],1/6)
            for stage in r['stages'][1:]:
                self.assertEqual(stage['splits']['new_entities']['accuracy'],1)
                self.assertEqual(stage['splits']['untrained_wording']['correct'],0)
                self.assertEqual(stage['splits']['untrained_wording']['wrong_predictions'],4)
                self.assertEqual(stage['inference_writes'],0)
            self.assertTrue((Path(d)/'trained_language_model.sqlite3').is_file())
    def test_parse_cache_external_write_invalidation(self):
        with tempfile.TemporaryDirectory() as d:
            first=Engine(database=d+'/db');first.roles.learn(TRAIN[:3])
            self.assertEqual(first.roles.parse(HOLDOUT[0]['text'])['status'],'predicted')
            second=Engine(database=d+'/db')
            try:
                second.roles.learn([{'text':x['text'],'record':{'actor':x['record']['object'],'action':x['record']['action'],'object':x['record']['actor']}} for x in TRAIN[:3]])
                self.assertEqual(first.roles.parse(HOLDOUT[0]['text'])['status'],'ambiguous')
            finally:second.close();first.close()

    def test_cached_results_are_independent(self):
        e=Engine(database=':memory:')
        try:
            e.roles.learn(TRAIN[:3])
            result=e.roles.parse(TRAIN[0]['text'])
            result['candidates'][0]['record']['actor']='corrupted'
            for evidence in result['candidates'][0]['evidence']:
                if 'examples' in evidence:evidence['examples'].clear()
            fresh=e.roles.parse(TRAIN[0]['text'])
            self.assertEqual(fresh['candidates'][0]['record'],TRAIN[0]['record'])
            self.assertTrue(all(x['examples'] for x in fresh['candidates'][0]['evidence'] if 'examples' in x))
        finally:e.close()
