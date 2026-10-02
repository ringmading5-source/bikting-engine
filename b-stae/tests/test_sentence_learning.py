import os
import tempfile
import unittest
from engine import Engine
from sentence_learning_demo import TRAINING, CASES

class SentenceLearningTests(unittest.TestCase):
 def setUp(self):self.engine=Engine(database=':memory:')
 def tearDown(self):self.engine.close()
 def train(self):
  for index,text in enumerate(TRAINING):self.engine.text_gaps.learn(text,str(index))
 def test_unseen_phrase_and_whole_sentence_gaps(self):
  self.train();before=self.engine.db.total_changes;memory=self.engine.patterns.stats()
  report=self.engine.sentences.evaluate(CASES)
  self.assertEqual(report['correct'],3)
  self.assertTrue(all(c['correct'] for c in report['cases'][:3]))
  self.assertEqual(report['cases'][3]['status'],'ambiguous')
  self.assertEqual(report['cases'][4]['status'],'unknown')
  self.assertEqual(self.engine.db.total_changes,before);self.assertEqual(self.engine.patterns.stats(),memory)
 def test_continuation_and_sources(self):
  self.train();prediction=self.engine.sentences.continue_sentence('Today the plant')
  self.assertEqual(prediction['status'],'predicted')
  self.assertEqual(prediction['preferred'][0]['completed_sentence'],'today the plant uses sunlight to make food during the day.')
  self.assertTrue(prediction['preferred'][0]['evidence'])
  self.assertFalse(prediction['verified'])
 def test_conflicts_are_retained(self):
  self.train();before=self.engine.db.execute('SELECT count(*) FROM gap_documents').fetchone()[0]
  result=self.engine.sentences.predict('Today the child likes <mask> after dinner.')
  self.assertEqual({c['text'] for c in result['preferred']},{'warm tea','fresh juice'})
  self.assertEqual(self.engine.db.execute('SELECT count(*) FROM gap_documents').fetchone()[0],before)
 def test_bounds_leakage_and_context(self):
  self.train()
  with self.assertRaises(ValueError):self.engine.sentences.predict('a <mask> b',max_tokens=0)
  with self.assertRaises(ValueError):self.engine.sentences.predict('a <mask> b',sentence_end=1)
  with self.assertRaises(ValueError):self.engine.sentences.evaluate([{'text':'The plant <mask> during the day.','expected':'uses sunlight to make food'}])
  self.assertEqual(self.engine.sentences.predict(CASES[0]['text'],'other')['status'],'unknown')
  self.assertFalse(self.engine.sentences.predict(CASES[0]['text'],max_tokens=2)['preferred'][0]['tokens']==['uses','sunlight','to','make','food'])
 def test_restart_and_api(self):
  from app import Application
  with tempfile.TemporaryDirectory() as folder:
   path=os.path.join(folder,'memory.db');first=Engine(database=path)
   for index,text in enumerate(TRAINING):first.text_gaps.learn(text,str(index))
   first.close();second=Engine(database=path)
   try:
    app=Application(second)
    self.assertEqual(app.dispatch({'action':'sentence_predict','text':CASES[0]['text']})['preferred'][0]['text'],CASES[0]['expected'])
    self.assertEqual(app.dispatch({'action':'sentence_continue','text':'Today the plant'})['status'],'predicted')
    self.assertEqual(app.dispatch({'action':'sentence_evaluate','cases':CASES})['correct'],3)
   finally:second.close()
