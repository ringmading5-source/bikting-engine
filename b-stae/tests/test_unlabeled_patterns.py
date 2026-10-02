import json
import tempfile
import unittest
from engine import Engine
from app import Application
from unlabeled_patterns import UnlabeledPatternModel

TRAINING=[f'{name} carries {item}. Later {name} stores {item}.' for name,item in [('Mira','amber'),('Kito','jade'),('Sena','silver')]]
CASES=[
 {'text':'Taro carries copper. Later <mask> stores copper.','expected':'taro'},
 {'text':'Nela carries bronze. Later Nela stores <mask>.','expected':'bronze'},
 {'text':'Vexo carries <mask>. Later Vexo stores quartz.','expected':'quartz'}]

class UnlabeledPatternTests(unittest.TestCase):
 def setUp(self):self.engine=Engine(database=':memory:');self.learner=self.engine.unlabeled_patterns
 def tearDown(self):self.engine.close()
 def test_heldout_unseen_words_and_baselines(self):
  learned=self.learner.learn(TRAINING)
  self.assertEqual(learned['status'],'learned');self.assertEqual(learned['labels_supplied'],0)
  before=self.engine.db.total_changes
  report=self.learner.evaluate(learned['model_id'],CASES)
  self.assertEqual(report['correct'],3);self.assertEqual(report['exact_baseline_correct'],0)
  self.assertEqual(report['frequency_baseline_correct'],0)
  self.assertTrue(all(c['expected_word_unseen'] for c in report['cases']))
  self.assertEqual(self.engine.db.total_changes,before)
 def test_portable_parameters_only(self):
  parameters=UnlabeledPatternModel.fit(TRAINING).export()
  model=UnlabeledPatternModel(json.loads(json.dumps(parameters)))
  self.assertNotIn('mira',json.dumps(parameters));self.assertNotIn('amber',json.dumps(parameters))
  result=model.predict(CASES[0]['text'])
  self.assertEqual(result['status'],'predicted');self.assertEqual(result['candidates'][0]['word'],'taro')
  self.assertEqual(result['training_example_lookups'],0)
 def test_variable_positions_learned_not_fixed(self):
  swapped=[f'{name} carries {item}. Later {item} stores {name}.' for name,item in [('Mira','amber'),('Kito','jade'),('Sena','silver')]]
  model=UnlabeledPatternModel.fit(swapped)
  result=model.predict('Taro carries copper. Later <mask> stores Taro.')
  self.assertEqual(result['status'],'predicted');self.assertEqual(result['candidates'][0]['word'],'copper')
 def test_inconsistent_context_unknown(self):
  model=UnlabeledPatternModel.fit(TRAINING)
  self.assertEqual(model.predict('Taro carries copper. Later <mask> stores bronze.')['status'],'unknown')
  self.assertEqual(model.predict('Taro eats copper. Later <mask> stores copper.')['status'],'unknown')
 def test_unsupported_singletons_and_mixed_passages(self):
  model=UnlabeledPatternModel.fit(['Mira carries amber.','Kito carries jade.','Sena carries silver.'])
  self.assertEqual(model.predict('Taro carries <mask>.')['status'],'unknown')
  mixed=UnlabeledPatternModel.fit(TRAINING+['Rain falls.','The wind rises slowly.','A leaf drifts down.'])
  self.assertEqual(mixed.predict(CASES[1]['text'])['candidates'][0]['word'],'bronze')
 def test_repeated_examples_not_support_and_leakage(self):
  with self.assertRaises(ValueError):self.learner.learn([TRAINING[0]]*3)
  learned=self.learner.learn(TRAINING)
  with self.assertRaises(ValueError):self.learner.evaluate(learned['model_id'],[{'text':'Mira carries amber. Later <mask> stores amber.','expected':'Mira'}])
  with self.assertRaises(ValueError):self.learner.evaluate(learned['model_id'],[CASES[0],CASES[0]])
 def test_persistence_api_and_training_removed(self):
  with tempfile.TemporaryDirectory() as folder:
   first=Engine(database=folder+'/patterns.db')
   learned=Application(first).dispatch({'action':'unlabeled_pattern_learn','passages':TRAINING})
   first.db.execute("UPDATE unlabeled_pattern_models SET training='[]'");first.db.commit();first.close()
   second=Engine(database=folder+'/patterns.db')
   try:
    result=Application(second).dispatch({'action':'unlabeled_pattern_predict','model_id':learned['model_id'],'text':CASES[0]['text']})
    self.assertEqual(result['candidates'][0]['word'],'taro')
   finally:second.close()
 def test_input_bounds(self):
  for passages in (TRAINING[:2],['<mask> word']*3,['a '*100]*3):
   with self.assertRaises(ValueError):self.learner.learn(passages)
  learned=self.learner.learn(TRAINING)
  for text in ('no mask','<mask> and <mask>',None):
   with self.assertRaises(ValueError):self.learner.predict(learned['model_id'],text)
