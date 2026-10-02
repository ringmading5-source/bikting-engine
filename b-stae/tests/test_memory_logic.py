import tempfile
import unittest
from engine import Engine

EXAMPLES=[{'input':{'entity':word,'count':count},'output':{'form':word+'s','count':count,'multiple':count>1}}
          for word,count in [('cat',0),('dog',1),('horse',2),('bird',3)]]

class LogicTests(unittest.TestCase):
    def setUp(self):self.engine=Engine(database=':memory:')
    def tearDown(self):self.engine.close()
    def test_unseen_and_cross_levels(self):
        result=self.engine.memory_logic.learn(EXAMPLES,'q')
        self.assertEqual(result['status'],'learned')
        self.assertEqual({r['level'] for r in result['model']['rules']['form']},{'character','byte'})
        before=self.engine.db.total_changes
        for word,count in [('rabbit',3),('goat',1),('café',5)]:
            result=self.engine.memory_logic.predict({'entity':word,'count':count},'q')
            self.assertEqual(result['status'],'predicted')
            self.assertEqual(result['candidates'][0]['record'],{'form':word+'s','count':count,'multiple':count>1})
        self.assertEqual(before,self.engine.db.total_changes)
    def test_exception_preserved(self):
        self.engine.memory_logic.learn(EXAMPLES,'q')
        examples=[{'input':{'entity':word,'count':n},'output':{'form':form,'count':n,'multiple':True}}
                  for word,form,n in [('mouse','mice',2),('sheep','sheep',3),('person','people',4)]]
        self.engine.memory_logic.learn(examples,'q')
        result=self.engine.memory_logic.predict({'entity':'mouse','count':2},'q')
        self.assertEqual(result['status'],'ambiguous')
        self.assertEqual({r['record']['form'] for r in result['candidates']},{'mice','mouses'})
        self.assertEqual(self.engine.db.execute('SELECT count(*) FROM logic_examples').fetchone()[0],7)
    def test_labels_have_no_semantic_handler(self):
        examples=[{'input':{'x':e['input']['entity'],'n':e['input']['count']},'output':{'y':e['output']['form'],'b':e['output']['multiple']}} for e in EXAMPLES]
        self.engine.memory_logic.learn(examples)
        self.assertEqual(self.engine.memory_logic.predict({'x':'rabbit','n':8})['candidates'][0]['record'],{'y':'rabbits','b':True})
    def test_unknown_and_validation(self):
        self.assertEqual(self.engine.memory_logic.predict({'entity':'rabbit'})['status'],'unknown')
        with self.assertRaises(ValueError):self.engine.memory_logic.learn(EXAMPLES[:2])
        with self.assertRaises(ValueError):self.engine.memory_logic.predict({'x':[]})
    def test_restart_api(self):
        from app import Application
        with tempfile.TemporaryDirectory() as folder:
            first=Engine(database=folder+'/db');Application(first).dispatch({'action':'memory_logic_learn','examples':EXAMPLES});first.close()
            second=Engine(database=folder+'/db')
            try:self.assertEqual(Application(second).dispatch({'action':'memory_logic_predict','record':{'entity':'rabbit','count':2}})['status'],'predicted')
            finally:second.close()
