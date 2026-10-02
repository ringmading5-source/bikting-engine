import tempfile
import unittest
from engine import Engine
from app import Application
from test_relationship_composition import RULES, VALIDATION, QA, CONTEXT

class PassageTests(unittest.TestCase):
 def setUp(self):self.engine=Engine(database=':memory:');self.train(self.engine)
 def tearDown(self):self.engine.close()
 def train(self,engine):
  engine.text_transforms.learn(RULES,VALIDATION,CONTEXT)
  engine.text_relations.learn(QA,CONTEXT)
 def learn(self,text,source='test-passage'):
  return self.engine.passage_knowledge.learn(text,source,CONTEXT)
 def answer(self,question='Which field studies substances?'):
  return self.engine.passage_knowledge.answer(question,CONTEXT)
 def test_passage_composition_beats_direct_baseline(self):
  learned=self.learn('Chemistry studies matter. Matter includes substances. A pleasant afternoon follows.')
  self.assertEqual(learned['sentences'],3);self.assertEqual(learned['recognized_forms'],2)
  before=self.engine.db.total_changes
  report=self.engine.passage_knowledge.evaluate([{'question':'Which field studies substances?','expected':'chemistry'}],CONTEXT)
  self.assertEqual(report['correct'],1);self.assertEqual(report['direct_baseline_correct'],0)
  self.assertEqual(self.engine.db.total_changes,before)
  result=self.answer();self.assertEqual(result['status'],'answered')
  leaves=[n for n in result['trace'].values() if n['depth']==0]
  self.assertTrue(all(n['sources'][0]['source']=='test-passage' for n in leaves))
 def test_three_unseen_questions_against_direct_baseline(self):
  self.learn('Chemistry studies matter. Matter includes substances. Botany studies plants. Plants includes mosses. Ecology studies ecosystems. Ecosystems includes wetlands.')
  cases=[{'question':f'Which field studies {topic}?','expected':field} for field,topic in [('chemistry','substances'),('botany','mosses'),('ecology','wetlands')]]
  report=self.engine.passage_knowledge.evaluate(cases,CONTEXT)
  self.assertEqual(report['correct'],3);self.assertEqual(report['direct_baseline_correct'],0)
 def test_learned_paraphrase_and_multiword_entities(self):
  aliases=[{'input':f'{a} investigates {b}.','output':f'{a} studies {b}.'} for a,b,_ in [('biology','organisms',0),('physics','energy',0),('geology','rocks',0)]]
  self.engine.text_transforms.learn(aliases,[{'input':'astronomy investigates stars.','output':'astronomy studies stars.'}],CONTEXT)
  self.learn('Planetary science investigates cosmic objects. Cosmic objects includes icy moons.')
  result=self.answer('Which field studies icy moons?')
  self.assertEqual(result['status'],'answered');self.assertEqual(result['candidates'][0]['answer'],'planetary science')
 def test_missing_conflicting_unknown(self):
  self.learn('Chemistry studies matter. Energy includes substances.')
  self.assertEqual(self.answer()['status'],'unknown')
  self.learn('Matter includes substances. Biology studies matter.')
  result=self.answer();self.assertEqual(result['status'],'ambiguous')
  self.assertEqual({c['answer'] for c in result['candidates']},{'biology','chemistry'})
  self.assertEqual(self.answer('Which field studies galaxies?')['status'],'unknown')
 def test_restart_api_context(self):
  with tempfile.TemporaryDirectory() as folder:
   first=Engine(database=folder+'/knowledge.db');self.train(first)
   Application(first).dispatch({'action':'passage_learn','text':'Chemistry studies matter. Matter includes substances.','source':'document-a','context':CONTEXT})
   first.close();second=Engine(database=folder+'/knowledge.db')
   try:
    result=Application(second).dispatch({'action':'passage_answer','question':'Which field studies substances?','context':CONTEXT})
    self.assertEqual(result['status'],'answered')
    self.assertEqual(second.passage_knowledge.answer('Which field studies substances?')['status'],'unknown')
   finally:second.close()
 def test_audit_examples_not_needed(self):
  self.learn('Chemistry studies matter. Matter includes substances.')
  self.engine.db.execute("UPDATE text_transform_models SET training='[]',validation='{}'")
  self.engine.db.execute('DELETE FROM text_relation_examples')
  self.assertEqual(self.answer()['status'],'answered')
 def test_validation_and_leakage(self):
  with self.assertRaises(ValueError):self.engine.passage_knowledge.evaluate([{'question':QA[0]['question'],'expected':QA[0]['answer']}],CONTEXT)
  for text in ('',None,'word '*100):
   with self.assertRaises(ValueError):self.learn(text)
  self.assertEqual(self.engine.db.execute('SELECT count(*) FROM knowledge_passages').fetchone()[0],0)
 def test_fact_budget_and_unsupported_retained(self):
  self.learn(' '.join(f'field{x} studies topic{x}.' for x in range(25)))
  self.assertEqual(self.answer()['status'],'bounded')
  self.assertEqual(self.learn('The sunset is beautiful.')['recognized_forms'],0)
