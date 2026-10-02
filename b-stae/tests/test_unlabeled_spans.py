import json
import tempfile
import unittest
from engine import Engine
from app import Application
from unlabeled_spans import UnlabeledSpanModel

PAIRS=[('Mira','amber'),('the red robot','a green basket'),('a farmer','heavy books')]
TRAINING=[f'{name} carries {item}. Later {name} stores {item}.' for name,item in PAIRS]
CASES=[
 {'text':'The young student carries a blue bag. Later <mask> stores a blue bag.','expected':'the young student'},
 {'text':'A very curious little traveler carries copper. Later <mask> stores copper.','expected':'a very curious little traveler'},
 {'text':'Taro carries several polished copper tools. Later Taro stores <mask>.','expected':'several polished copper tools'},
 {'text':'Nela carries <mask>. Later Nela stores a bright yellow umbrella.','expected':'a bright yellow umbrella'}]

class UnlabeledSpanTests(unittest.TestCase):
 def setUp(self):self.engine=Engine(database=':memory:');self.learner=self.engine.unlabeled_spans
 def tearDown(self):self.engine.close()
 def test_unseen_lengths_and_baselines(self):
  learned=self.learner.learn(TRAINING)
  self.assertEqual(learned['status'],'learned');self.assertEqual(learned['labels_supplied'],0)
  before=self.engine.db.total_changes
  report=self.learner.evaluate(learned['model_id'],CASES)
  self.assertEqual(report['correct'],4);self.assertEqual(report['exact_baseline_correct'],0)
  self.assertEqual(report['frequency_baseline_correct'],0)
  self.assertTrue(all(case['unseen_word_count']>0 for case in report['cases']))
  self.assertEqual(self.engine.db.total_changes,before)
 def test_portable_and_reversed_links(self):
  model=UnlabeledSpanModel(json.loads(json.dumps(UnlabeledSpanModel.fit(TRAINING).export())))
  self.assertNotIn('mira',json.dumps(model.export()))
  self.assertEqual(model.predict(CASES[0]['text'])['candidates'][0]['text'],'the young student')
  swapped=[f'{name} carries {item}. Later {item} stores {name}.' for name,item in PAIRS]
  model=UnlabeledSpanModel.fit(swapped)
  result=model.predict('The student carries a blue bag. Later <mask> stores the student.')
  self.assertEqual(result['status'],'predicted');self.assertEqual(result['candidates'][0]['text'],'a blue bag')
 def test_mismatch_unseen_verb_and_partial_span_unknown(self):
  model=UnlabeledSpanModel.fit(TRAINING)
  for text in ('The student carries a blue bag. Later <mask> stores a red box.',
               'The student eats a blue bag. Later <mask> stores a blue bag.',
               'The young student carries a blue bag. Later the <mask> stores a blue bag.'):
   self.assertEqual(model.predict(text)['status'],'unknown')
 def test_bounds_and_unsupported(self):
  model=UnlabeledSpanModel.fit(TRAINING)
  self.assertEqual(model.predict(CASES[0]['text'],max_expansions=1)['status'],'bounded')
  for value in (True,0,10001):
   with self.assertRaises(ValueError):model.predict(CASES[0]['text'],max_expansions=value)
  with self.assertRaises(ValueError):self.learner.learn([TRAINING[0]]*3)
  self.assertEqual(UnlabeledSpanModel.fit(['Mira carries amber.','Kito carries jade.','Sena carries silver.']).export()['patterns'],[])
 def test_conflicting_fitted_models_remain_ambiguous(self):
  alternate=[f'{name} carries {item}. Later {item} stores {item}.' for name,item in PAIRS]
  params=UnlabeledSpanModel.fit(TRAINING).export()
  params['patterns']+=UnlabeledSpanModel.fit(alternate).export()['patterns']
  result=UnlabeledSpanModel(params).predict(CASES[0]['text'])
  self.assertEqual(result['status'],'ambiguous')
  self.assertEqual({c['text'] for c in result['candidates']},{'the young student','a blue bag'})
 def test_leakage_and_restart_api(self):
  learned=self.learner.learn(TRAINING)
  with self.assertRaises(ValueError):self.learner.evaluate(learned['model_id'],[{'text':'Mira carries amber. Later <mask> stores amber.','expected':'Mira'}])
  with self.assertRaises(ValueError):self.learner.evaluate(learned['model_id'],[CASES[0],CASES[0]])
  with tempfile.TemporaryDirectory() as folder:
   first=Engine(database=folder+'/spans.db')
   learned=Application(first).dispatch({'action':'unlabeled_span_learn','passages':TRAINING})
   first.db.execute("UPDATE unlabeled_span_models SET training='[]'");first.db.commit();first.close()
   second=Engine(database=folder+'/spans.db')
   try:
    result=Application(second).dispatch({'action':'unlabeled_span_predict','model_id':learned['model_id'],'text':CASES[0]['text']})
    self.assertEqual(result['candidates'][0]['text'],'the young student')
   finally:second.close()
