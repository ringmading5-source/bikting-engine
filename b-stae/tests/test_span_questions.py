import tempfile
import unittest
from engine import Engine
from app import Application
from test_unlabeled_spans import PAIRS, TRAINING

CONTEXT='span-qa'
VALID_PASSAGE='A patient teacher carries bright chalk. Later a patient teacher stores bright chalk.'

def examples(kind=0):
 return [{'passage':passage,'question':f'Who stores {item}?' if kind==0 else f'What does {name} store?' if kind==1 else f'Which person stores {item}?',
          'answer':name if kind!=1 else item} for passage,(name,item) in zip(TRAINING,PAIRS)]

def validation(kind=0):
 return [{'passage':VALID_PASSAGE,'question':'Who stores bright chalk?' if kind==0 else 'What does a patient teacher store?' if kind==1 else 'Which person stores bright chalk?',
          'answer':'a patient teacher' if kind!=1 else 'bright chalk'}]

class SpanQuestionTests(unittest.TestCase):
 def setUp(self):
  self.engine=Engine(database=':memory:')
  self.ident=self.engine.unlabeled_spans.learn(TRAINING,CONTEXT)['model_id']
  for kind in range(3):
   self.assertEqual(self.engine.span_questions.learn(self.ident,examples(kind),validation(kind),CONTEXT)['status'],'learned')
 def tearDown(self):self.engine.close()
 def learn(self,text,source='new-passage'):
  return self.engine.passage_knowledge.learn(text,source,CONTEXT)
 def answer(self,question):return self.engine.passage_knowledge.answer(question,CONTEXT)
 def test_integrated_questions_new_entities_lengths_and_wording(self):
  self.learn('The young student carries a blue bag. Later the young student stores a blue bag.')
  cases=[{'question':'Who stores a blue bag?','expected':'the young student'},
         {'question':'What does the young student store?','expected':'a blue bag'},
         {'question':'Which person stores a blue bag?','expected':'the young student'}]
  before=self.engine.db.total_changes
  report=self.engine.passage_knowledge.evaluate(cases,CONTEXT)
  self.assertEqual(report['correct'],3);self.assertEqual(report['direct_baseline_correct'],0)
  self.assertEqual(self.engine.db.total_changes,before)
  result=self.answer(cases[0]['question'])
  self.assertTrue(result['span_question_path']['candidates'])
  evidence=result['candidates'][0]['evidence'][0]
  self.assertEqual(evidence['span_evidence'][0]['span_model_id'],self.ident)
  self.assertEqual(result['trace'][evidence['fact']]['sources'][0]['source'],'new-passage')
 def test_wrong_bindings_and_unknown_wording(self):
  self.learn('The young student carries a blue bag. Later another student stores a blue bag.')
  self.assertEqual(self.answer('Who stores a blue bag?')['status'],'unknown')
  self.learn('The young student carries a blue bag. Later the young student stores a blue bag.')
  self.assertEqual(self.answer('Who hides a blue bag?')['status'],'unknown')
  self.assertEqual(self.answer('Tell me who stored a blue bag')['status'],'unknown')
 def test_competing_passages_and_context(self):
  self.learn('The student carries a blue bag. Later the student stores a blue bag.','one')
  self.learn('The traveler carries a blue bag. Later the traveler stores a blue bag.','two')
  result=self.answer('Who stores a blue bag?')
  self.assertEqual(result['status'],'ambiguous')
  self.assertEqual({c['answer'] for c in result['candidates']},{'the student','the traveler'})
  self.assertEqual(self.engine.passage_knowledge.answer('Who stores a blue bag?')['status'],'unknown')
 def test_training_audits_not_read_for_inference(self):
  self.learn('The student carries a blue bag. Later the student stores a blue bag.')
  self.engine.db.execute("UPDATE span_question_models SET training='[]'")
  self.engine.db.execute("UPDATE unlabeled_span_models SET training='[]'")
  self.assertEqual(self.answer('Who stores a blue bag?')['candidates'][0]['answer'],'the student')
 def test_leakage_and_unsupported_mapping(self):
  with self.assertRaises(ValueError):self.engine.span_questions.learn(self.ident,examples(),[examples()[0]],CONTEXT)
  with self.assertRaises(ValueError):self.engine.span_questions.learn(self.ident,examples(),validation(),'wrong-context')
  bad=[dict(e,answer=value) for e,value in zip(examples(),['alpha','beta','gamma'])]
  with self.assertRaises(ValueError):self.engine.span_questions.learn(self.ident,bad,validation(),CONTEXT)
  with self.assertRaises(ValueError):self.engine.passage_knowledge.evaluate([{'question':examples()[0]['question'],'expected':'Mira'}],CONTEXT)
 def test_another_verb_learned_without_handler(self):
  context='shipping'
  training=[text.replace('stores','ships') for text in TRAINING]
  ident=self.engine.unlabeled_spans.learn(training,context)['model_id']
  records=[{k:v.replace('stores','ships') for k,v in e.items()} for e in examples()]
  heldout=[{k:v.replace('stores','ships') for k,v in e.items()} for e in validation()]
  self.assertEqual(self.engine.span_questions.learn(ident,records,heldout,context)['status'],'learned')
  self.engine.passage_knowledge.learn('The traveler carries a red parcel. Later the traveler ships a red parcel.','shipping-doc',context)
  result=self.engine.passage_knowledge.answer('Who ships a red parcel?',context)
  self.assertEqual(result['status'],'answered');self.assertEqual(result['candidates'][0]['answer'],'the traveler')
 def test_wrong_validation_not_saved(self):
  records=validation();records[0]['answer']='wrong'
  before=self.engine.db.execute('SELECT count(*) FROM span_question_models').fetchone()[0]
  self.assertEqual(self.engine.span_questions.learn(self.ident,examples(),records,CONTEXT)['status'],'validation_failed')
  self.assertEqual(self.engine.db.execute('SELECT count(*) FROM span_question_models').fetchone()[0],before)
 def test_api_restart_and_bounds(self):
  with tempfile.TemporaryDirectory() as folder:
   first=Engine(database=folder+'/qa.db');app=Application(first)
   ident=app.dispatch({'action':'unlabeled_span_learn','passages':TRAINING,'context':CONTEXT})['model_id']
   app.dispatch({'action':'span_question_learn','span_model_id':ident,'examples':examples(),'validation':validation(),'context':CONTEXT})
   app.dispatch({'action':'passage_learn','text':'The student carries a blue bag. Later the student stores a blue bag.','source':'api','context':CONTEXT})
   first.close();second=Engine(database=folder+'/qa.db')
   try:
    result=Application(second).dispatch({'action':'passage_answer','question':'Who stores a blue bag?','context':CONTEXT})
    self.assertEqual(result['candidates'][0]['answer'],'the student')
   finally:second.close()
  with self.assertRaises(ValueError):self.engine.passage_knowledge.answer('Who stores a bag?',CONTEXT,max_depth=True)
