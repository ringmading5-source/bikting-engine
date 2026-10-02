import os
import tempfile
import unittest
from engine import Engine
from text_gap_demo import TRAINING, CASES

class TextGapTests(unittest.TestCase):
 def setUp(self):self.engine=Engine(database=':memory:')
 def tearDown(self):self.engine.close()
 def train(self):
  for index,text in enumerate(TRAINING):self.engine.text_gaps.learn(text,str(index))
 def test_bidirectional_generalization_and_baseline(self):
  self.train();before=self.engine.patterns.stats();changes=self.engine.db.total_changes
  report=self.engine.text_gaps.evaluate(CASES)
  self.assertGreater(report['accuracy'],report['baseline_accuracy'])
  self.assertTrue(all(r['correct'] for r in report['cases'][:9]))
  self.assertEqual(report['cases'][9]['status'],'ambiguous')
  self.assertTrue(all(r['status']=='unknown' for r in report['cases'][10:]))
  self.assertEqual(self.engine.patterns.stats(),before);self.assertEqual(self.engine.db.total_changes,changes)
  prediction=self.engine.text_gaps.predict('Sometimes the <mask> swims in rivers.')
  self.assertEqual(prediction['preferred'][0]['token'],'fish')
  self.assertTrue(any(e['right_units']>0 for e in prediction['preferred'][0]['evidence']))
 def test_conflicts_sources_and_case(self):
  gaps=self.engine.text_gaps
  gaps.learn('The child likes tea.','one');gaps.learn('The child likes juice.','two')
  prediction=gaps.predict('TODAY THE CHILD LIKES <mask>.')
  self.assertEqual(prediction['status'],'ambiguous')
  self.assertEqual({c['token'] for c in prediction['preferred']},{'tea','juice'})
  self.assertEqual({e['source'] for c in prediction['preferred'] for e in c['evidence']},{'one','two'})
  self.assertEqual(self.engine.db.execute('SELECT count(*) FROM gap_documents').fetchone()[0],2)
 def test_leakage_rejected_and_baseline_ignores_test(self):
  self.train()
  with self.assertRaises(ValueError):self.engine.text_gaps.evaluate([{'text':'The cat drinks <mask>.','expected':'milk'}])
  with self.assertRaises(ValueError):self.engine.text_gaps.evaluate([CASES[0],CASES[0]])
  self.assertNotIn('glows',self.engine.text_gaps.vocabulary())
  self.engine.text_gaps.learn('First sentence. The rabbit eats carrots. Last sentence.','paragraph')
  with self.assertRaises(ValueError):self.engine.text_gaps.evaluate([{'text':'The rabbit eats <mask>.','expected':'carrots'}])
 def test_context_and_empty_memory(self):
  self.assertEqual(self.engine.text_gaps.predict('a <mask> b')['status'],'unknown')
  self.engine.text_gaps.learn('cat drinks milk','one','domain-a')
  self.assertEqual(self.engine.text_gaps.predict('cat drinks <mask>','domain-b')['status'],'unknown')
 def test_validation_and_restart(self):
  for value in ('no mask','<mask> and <mask>'):
   with self.assertRaises(ValueError):self.engine.text_gaps.predict(value)
  with self.assertRaises(ValueError):self.engine.text_gaps.learn('text','source',window=True)
  with tempfile.TemporaryDirectory() as directory:
   path=os.path.join(directory,'memory.db');first=Engine(database=path)
   first.text_gaps.learn('cat drinks milk','source');first.close();second=Engine(database=path)
   try:self.assertEqual(second.text_gaps.predict('new cat drinks <mask>')['preferred'][0]['token'],'milk')
   finally:second.close()
 def test_api(self):
  from app import Application
  app=Application(self.engine)
  app.dispatch({'action':'text_gap_learn','text':'cat drinks milk','source':'api'})
  result=app.dispatch({'action':'text_gap_predict','text':'new cat drinks <mask>'})
  self.assertEqual(result['preferred'][0]['token'],'milk')
  self.assertTrue(app.dispatch({'action':'text_gap_baseline'})['preferred'])
  self.assertEqual(app.dispatch({'action':'text_gap_evaluate','cases':[{'text':'new cat drinks <mask>','expected':'milk'}]})['correct'],1)
