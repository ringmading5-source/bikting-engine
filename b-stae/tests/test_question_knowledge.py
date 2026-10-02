import tempfile
import unittest
from engine import Engine
from knowledge_question_demo import SUBJECTS,FACTS,FORMS,train_questions

class QuestionKnowledgeTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:')
    def tearDown(self):self.e.close()
    def test_failed_alignment_sets_now_transfer_both_modes(self):
        for mode in ('character','byte'):
            for names in (SUBJECTS[:3],SUBJECTS):
                context=[mode,len(names)]
                r=self.e.internal_states.learn([{'before':f'what is {name}?','after':f'define {name}','source':'regression'} for name in names],context,mode)
                self.assertEqual(r['status'],'learned')
                for topic in ('chemistry','organic chemistry','mathematics'):
                    p=self.e.internal_states.predict(f'what is {topic}?',context,mode)
                    self.assertEqual(p['status'],'predicted');self.assertEqual(p['candidates'][0]['text'],'define '+topic)
    def test_heldout_subjects_known_facts_and_read_only(self):
        self.e.question_knowledge.learn_facts(FACTS,'knowledge')
        for mode in ('character','byte'):
            self.assertTrue(all(r['status']=='learned' for r in train_questions(self.e,mode=mode)))
            before=self.e.db.total_changes
            for fact in FACTS:
                self.assertNotIn(fact['subject'],SUBJECTS)
                for _,form in FORMS:
                    r=self.e.question_knowledge.answer(form.format(subject=fact['subject']),'knowledge',mode)
                    self.assertEqual(r['status'],'answered');self.assertEqual(r['answers'][0]['text'],fact['definition'])
                    self.assertTrue(r['answers'][0]['sources'])
            self.assertEqual(before,self.e.db.total_changes)
    def test_missing_pattern_vs_missing_knowledge_and_conflict(self):
        train_questions(self.e)
        r=self.e.question_knowledge.answer('what is chemistry?','knowledge')
        self.assertEqual(r['status'],'unknown');self.assertIn('No stored definition',r['reason'])
        self.e.question_knowledge.learn_facts(FACTS,'knowledge')
        r=self.e.question_knowledge.answer('why is chemistry useful?','knowledge')
        self.assertEqual(r['status'],'unknown');self.assertIn('No applicable',r['reason'])
        self.e.question_knowledge.learn_facts([dict(FACTS[0],definition='A contradictory test definition.',source='test:conflict')],'knowledge')
        r=self.e.question_knowledge.answer('What is CHEMISTRY?','knowledge')
        self.assertEqual(r['status'],'ambiguous');self.assertEqual(len(r['answers']),2)
    def test_reference_sources_and_boundary_collision(self):
        train_questions(self.e)
        self.e.question_knowledge.learn_facts([{'subject':s,'definition':s+' test definition.','source':'test'} for s in ('cat','cot')],'knowledge')
        r=self.e.question_knowledge.answer('what is cat?','knowledge')
        self.assertEqual(r['status'],'answered');self.assertEqual(r['answers'][0]['text'],'cat test definition.')
        self.assertEqual(r['knowledge_lookups'][0]['retrieval']['rejected_states'],1)
    def test_restart_api_and_validation(self):
        from app import Application
        with tempfile.TemporaryDirectory() as folder:
            first=Engine(database=folder+'/db');train_questions(first);first.question_knowledge.learn_facts(FACTS,'knowledge');first.close()
            second=Engine(database=folder+'/db')
            try:
                r=Application(second).dispatch({'action':'knowledge_question_answer','question':'what is chemistry?','context':'knowledge'})
                self.assertEqual(r['status'],'answered')
            finally:second.close()
        with self.assertRaises(ValueError):self.e.question_knowledge.learn_facts([{'subject':'x'}])
