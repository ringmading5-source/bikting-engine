import unittest
from engine import Engine
from app import Application

class BehaviorTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:');self.app=Application(self.e);self.lib=self.app.tasks.behaviors
    def tearDown(self):self.e.close()
    def task(self,text,value,expected,**options):return self.app.tasks.execute(text,value,{'equals':expected},**options)
    def test_inventory_has_executable_contracts(self):
        inventory=self.app.dispatch({'action':'behavior_inventory'})['behaviors']
        self.assertEqual(len(inventory),11)
        self.assertTrue(all({'input_type','output_type','verifier','implementation','source','bounds'}<=set(s) for s in inventory))
    def test_new_compositions_change_type(self):
        self.app.gemini.transport=lambda *args:self.fail('unexpected LLM call')
        examples=[('multiply by 3 then add 2',4,14),('divide exactly by 2 then multiply by 5',8,20),('trim then uppercase then count characters','  hi 🤔  ',4),('sort ascending then sum values then multiply by 2',[3,-2,3],8),('replace "cat" with "dog" then uppercase','cat cat','DOG DOG')]
        for text,value,expected in examples:
            with self.subTest(text=text):
                result=self.task(text,value,expected)
                self.assertTrue(result['verified']);self.assertEqual(result['result'],expected)
                self.assertEqual(result['plan']['model_calls'],0)
                self.assertEqual(self.task(text,value,expected)['plan']['source'],'verified_memory')
    def test_wrong_type_and_arithmetic_preconditions(self):
        for text,value in [('uppercase',4),('divide by 0',4),('divide by 3',4),('multiply by 2',2**62),('sum values',[2**62,2**62]),('replace "" with "x"','a')]:
            with self.subTest(text=text),self.assertRaises((ValueError,OverflowError)):
                self.task(text,value,0)
        self.assertEqual(self.e.db.execute('SELECT COUNT(*) FROM verified_task_plans').fetchone()[0],0)
    def test_corrupt_spec_not_executed(self):
        self.e.db.execute("UPDATE executable_behaviors SET specification='{}' WHERE id='multiply'")
        with self.assertRaises(ValueError):self.task('multiply by 2',4,8)
    def test_wrong_goal_does_not_publish(self):
        self.assertEqual(self.task('sort ascending',[3,1,2],[1,3,2])['status'],'goal_mismatch')
        self.assertEqual(self.e.db.execute('SELECT COUNT(*) FROM verified_task_plans').fetchone()[0],0)
    def test_cached_plan_respects_new_budget(self):
        self.task('multiply by 2 then add 1',4,9)
        with self.assertRaises(ValueError):self.task('multiply by 2 then add 1',4,9,max_actions=1)
    def test_series_bounds_booleans_and_unicode(self):
        for value in [[],[True],[0]*513]:
            with self.assertRaises(ValueError):self.task('sum values',value,0)
        self.assertEqual(self.task('lowercase','ΟΣ','ος')['result'],'ος')
        self.assertEqual(self.task('sort descending',[1,3,1],[3,1,1])['result'],[3,1,1])
