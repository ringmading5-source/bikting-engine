import unittest
from engine import Engine
from app import Application

CONTEXT='composition-test'
TRIPLES=[('biology','organisms','animals'),('physics','energy','heat'),('geology','rocks','granite')]
RULES=[{'input':f'{a} studies {b}. {b} includes {c}.','output':f'{a} studies {c}.'} for a,b,c in TRIPLES]
VALIDATION=[{'input':'astronomy studies objects. objects includes stars.','output':'astronomy studies stars.'}]
QA=[{'statement':f'{a} studies {b}.','question':f'Which field studies {b}?','answer':a,'source':'synthetic-training'} for a,b,_ in TRIPLES]

class CompositionTests(unittest.TestCase):
 def setUp(self):
  self.engine=Engine(database=':memory:')
  self.assertEqual(self.engine.text_transforms.learn(RULES,VALIDATION,CONTEXT)['status'],'learned')
  self.assertEqual(self.engine.text_relations.learn(QA,CONTEXT)['status'],'learned')
 def tearDown(self):self.engine.close()
 def answer(self,facts,question='Which field studies substances?',**kwargs):
  return self.engine.relationship_composition.answer(facts,question,CONTEXT,**kwargs)
 def test_unseen_two_statement_question(self):
  before=self.engine.db.total_changes
  result=self.answer(['Chemistry studies matter.','Matter includes substances.'])
  self.assertEqual(result['status'],'answered')
  self.assertEqual([c['answer'] for c in result['candidates']],['chemistry'])
  derived=[n for n in result['trace'].values() if n['text']=='chemistry studies substances.'][0]
  self.assertEqual(derived['depth'],1);self.assertEqual(len(derived['parents']),2)
  self.assertEqual(self.engine.db.total_changes,before)
 def test_bridge_must_match_and_missing_fact(self):
  self.assertEqual(self.answer(['Chemistry studies matter.','Energy includes substances.'])['status'],'unknown')
  self.assertEqual(self.answer(['Chemistry studies matter.'])['status'],'unknown')
 def test_multihop_and_depth(self):
  facts=['Chemistry studies matter.','Matter includes substances.','Substances includes salts.']
  self.assertEqual(self.answer(facts,'Which field studies salts?',max_depth=1)['status'],'unknown')
  result=self.answer(facts,'Which field studies salts?',max_depth=2)
  self.assertEqual(result['status'],'answered');self.assertEqual(result['candidates'][0]['answer'],'chemistry')
  self.assertEqual(max(n['depth'] for n in result['trace'].values()),2)
 def test_conflicts_and_budget(self):
  facts=['Chemistry studies matter.','Biology studies matter.','Matter includes substances.']
  result=self.answer(facts)
  self.assertEqual(result['status'],'ambiguous')
  self.assertEqual({c['answer'] for c in result['candidates']},{'biology','chemistry'})
  result=self.answer(facts,max_expansions=1)
  self.assertEqual(result['status'],'bounded');self.assertEqual(result['expansions'],1)
 def test_api_no_audit_example_access(self):
  self.engine.db.execute("UPDATE text_transform_models SET training='[]',validation='{}'")
  self.engine.db.execute('DELETE FROM text_relation_examples')
  result=Application(self.engine).dispatch({'action':'relationship_compose_answer','facts':['Chemistry studies matter.','Matter includes substances.'],'question':'Which field studies substances?','context':CONTEXT})
  self.assertEqual(result['status'],'answered')
  self.assertEqual(result['candidates'][0]['answer'],'chemistry')
 def test_unknown_relation_context_and_invalid_bounds(self):
  self.assertEqual(self.answer(['Chemistry likes matter.','Matter includes substances.'])['status'],'unknown')
  self.assertEqual(self.engine.relationship_composition.answer(['Chemistry studies matter.'],'Which field studies matter?')['status'],'unknown')
  with self.assertRaises(ValueError):self.answer(['Chemistry studies matter.'],max_depth=True)
