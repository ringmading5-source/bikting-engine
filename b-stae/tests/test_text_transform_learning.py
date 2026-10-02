import json
import tempfile
import unittest
from engine import Engine
from app import Application
from text_transform_learning import TextTransformModel

EXAMPLES=[{'input':f'{s} studies {t}.','output':f'{s} is the study of {t}.'} for s,t in [('chemistry','matter'),('biology','organisms'),('physics','energy')]]
VALIDATION=[{'input':'Astronomy studies celestial bodies.','output':'astronomy is the study of celestial bodies.'}]

class TextTransformTests(unittest.TestCase):
 def setUp(self):self.engine=Engine(database=':memory:');self.learner=self.engine.text_transforms
 def tearDown(self):self.engine.close()
 def test_example_free_inference_with_unseen_words(self):
  portable=TextTransformModel(json.loads(json.dumps(TextTransformModel.fit(EXAMPLES).export())))
  for subject,topic in [('geology','rocks'),('linguistics','human languages'),('zorbology','glowing zorbs')]:
   result=portable.predict(f'{subject} studies {topic}.')
   self.assertEqual(result['status'],'predicted')
   self.assertEqual(result['outputs'],[f'{subject} is the study of {topic}.'])
   self.assertEqual(result['training_example_lookups'],0)
  self.assertNotIn('chemistry',json.dumps(portable.export()))
 def test_validation_and_no_example_reads(self):
  learned=self.learner.learn(EXAMPLES,VALIDATION)
  self.assertEqual(learned['status'],'learned');self.assertEqual(learned['validation']['correct'],1)
  self.engine.db.execute("UPDATE text_transform_models SET training='[]',validation='{}'")
  before=self.engine.db.total_changes
  result=self.learner.predict('Geology studies ancient rocks.')
  self.assertEqual(result['candidates'][0]['text'],'geology is the study of ancient rocks.')
  self.assertEqual(self.engine.db.total_changes,before)
 def test_leakage_and_failed_validation(self):
  with self.assertRaises(ValueError):self.learner.learn(EXAMPLES,[EXAMPLES[0]])
  bad=[{'input':'Astronomy studies celestial bodies.','output':'unrelated answer'}]
  self.assertEqual(self.learner.learn(EXAMPLES,bad)['status'],'validation_failed')
  self.assertEqual(self.learner.predict(VALIDATION[0]['input'])['status'],'unknown')
 def test_unknown_and_conflicts(self):
  self.learner.learn(EXAMPLES,VALIDATION)
  self.assertEqual(self.learner.predict('What is geology?')['status'],'unknown')
  second=[dict(e,output=e['input'].split()[0]+'.') for e in EXAMPLES]
  self.learner.learn(second,[{'input':'Astronomy studies celestial bodies.','output':'astronomy.'}])
  self.assertEqual(self.learner.predict(VALIDATION[0]['input'])['status'],'ambiguous')
 def test_api_restart_context(self):
  with tempfile.TemporaryDirectory() as folder:
   first=Engine(database=folder+'/model.db')
   Application(first).dispatch({'action':'text_transform_learn','examples':EXAMPLES,'validation':VALIDATION,'context':'science'})
   first.close();second=Engine(database=folder+'/model.db')
   try:
    result=Application(second).dispatch({'action':'text_transform_predict','text':'Geology studies rocks.','context':'science'})
    self.assertEqual(result['status'],'predicted')
    self.assertEqual(second.text_transforms.predict('Geology studies rocks.')['status'],'unknown')
   finally:second.close()
 def test_unlearnable_mapping_rejected(self):
  with self.assertRaises(ValueError):TextTransformModel.fit([dict(e,output=v) for e,v in zip(EXAMPLES,['a','b','c'])])
