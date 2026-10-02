import os
import tempfile
import unittest
from engine import Engine
from text_relationship_demo import EXAMPLES, TESTS
from text_relationship_learning import bind

class TextRelationshipTests(unittest.TestCase):
 def setUp(self):self.engine=Engine(database=':memory:')
 def tearDown(self):self.engine.close()
 def test_unseen_subjects_answers_and_lengths(self):
  learner=self.engine.text_relations;learned=learner.learn(EXAMPLES,'drink')
  self.assertEqual(learned['status'],'learned');before=self.engine.db.total_changes
  for subject,object in TESTS:
   output=learner.answer(f'The {subject} drinks {object}.',f'What does the {subject} drink?','drink')
   self.assertEqual(output['status'],'answered');self.assertEqual(output['candidates'][0]['answer'],object)
   self.assertTrue(all(object!=e['answer'] for e in EXAMPLES));self.assertFalse(output['verified'])
  self.assertEqual(self.engine.db.total_changes,before)
 def test_changed_fact_and_wrong_subject(self):
  learner=self.engine.text_relations;learner.learn(EXAMPLES,'drink')
  for object in ('lemonade','coffee'):
   self.assertEqual(learner.answer('The robot drinks '+object+'.','What does the robot drink?','drink')['candidates'][0]['answer'],object)
  self.assertEqual(learner.answer('The robot drinks coffee.','What does the cat drink?','drink')['status'],'unknown')
  self.assertEqual(learner.answer('The bird eats seeds.','What does the bird eat?','drink')['status'],'unknown')
 def test_other_relationship_without_verb_handler(self):
  learner=self.engine.text_relations
  examples=[{'statement':f'A {subject} carries {object}.','question':f'Who carries {object}?','answer':subject,'source':'test'}
            for subject,object in [('child','books'),('robot','tools'),('farmer','seeds')]]
  self.assertEqual(learner.learn(examples,'other')['status'],'learned')
  output=learner.answer('A little girl carries a blue basket.','Who carries a blue basket?','other')
  self.assertEqual(output['status'],'answered');self.assertEqual(output['candidates'][0]['answer'],'little girl')
 def test_conflicting_labels_stay_ambiguous(self):
  learner=self.engine.text_relations;learner.learn(EXAMPLES,'drink')
  contradictory=[dict(example,answer=example['statement'].split()[1]) for example in EXAMPLES]
  self.assertEqual(learner.learn(contradictory,'drink')['status'],'learned')
  result=learner.answer('The robot drinks coffee.','What does the robot drink?','drink')
  self.assertEqual(result['status'],'ambiguous')
  self.assertEqual({c['answer'] for c in result['candidates']},{'coffee','robot'})
  self.assertEqual(self.engine.db.execute('SELECT count(*) FROM text_relation_examples').fetchone()[0],6)
 def test_unsupported_outputs_retained(self):
  examples=[dict(e,answer=value) for e,value in zip(EXAMPLES,['alpha','beta','gamma'])]
  self.assertEqual(self.engine.text_relations.learn(examples)['status'],'unsupported_relationship')
  self.assertEqual(self.engine.db.execute('SELECT count(*) FROM text_relation_examples').fetchone()[0],3)
 def test_restart_api_and_bounds(self):
  from app import Application
  with tempfile.TemporaryDirectory() as folder:
   path=os.path.join(folder,'memory.db');first=Engine(database=path)
   Application(first).dispatch({'action':'text_relation_learn','examples':EXAMPLES,'context':'a'});first.close();second=Engine(database=path)
   try:
    app=Application(second);result=app.dispatch({'action':'text_relation_answer','statement':'The robot drinks coffee.','question':'What does the robot drink?','context':'a'})
    self.assertEqual(result['candidates'][0]['answer'],'coffee')
    self.assertEqual(app.dispatch({'action':'text_relation_transform','statement':'The robot drinks coffee.','context':'a'})['status'],'transformed')
   finally:second.close()
  _,limited=bind([{'slot':x} for x in range(10)],list('abcdefghijklmno'),max_bindings=1)
  self.assertTrue(limited)
  with self.assertRaises(ValueError):self.engine.text_relations.learn(EXAMPLES[:2])
