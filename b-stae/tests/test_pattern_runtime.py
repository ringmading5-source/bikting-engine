import os
import tempfile
import unittest
from engine import Engine
from relationship_discovery import apply

class RuntimeTests(unittest.TestCase):
    def setUp(self):self.engine=Engine(database=':memory:')
    def tearDown(self):self.engine.close()
    def train(self,engine=None):
        engine=engine or self.engine
        for context,f in [('increment',lambda x:x+1),('double',lambda x:2*x)]:
            for index,units in enumerate(([1,3,5],[2,4,6,8],[0,7,9,11,13])):
                engine.patterns.learn_pair(units,[f(x) for x in units],'number',str(index),context)
            engine.discovery_patterns.discover('number',context)
    def test_unseen_composition_replayed(self):
        self.train()
        for units in ([20,30],[7,9,11,13,15,17]):
            target=[2*(x+1) for x in units]
            result=self.engine.pattern_runtime.plan(list(units),target,'number',['increment','double'],max_depth=2)
            self.assertEqual(result['status'],'predicted_goal_matched')
            self.assertEqual(len(result['plan']),2)
            current=list(units)
            for step in result['plan']:
                current=apply(step['program'],current)
                self.assertEqual(current,step['after'])
                expected=[x+1 for x in step['before']] if step['context']=='increment' else [2*x for x in step['before']]
                self.assertEqual(current,expected)
            self.assertEqual(current,target)
            self.assertFalse(result['outcome_verified'])
    def test_goal_selection_and_feedback_without_erasure(self):
        self.train();runtime=self.engine.pattern_runtime
        before=self.engine.discovery_patterns.inventory('number','increment')
        selection=runtime.select([20,30],'number','increment',[21,31])
        self.assertEqual(selection['status'],'selected')
        h=selection['preferred'][0]['hypotheses'][0]
        old_score=next(x['score'] for x in runtime.hypotheses('number','increment',[21,31]) if x['program_id']==h['program_id'])
        wrong=runtime.feedback([20,30],[99,99],h['program'],'number','test:observed','increment',[21,31])
        self.assertFalse(wrong['prediction_matched']);self.assertFalse(wrong['goal_matched'])
        inventory=runtime.hypotheses('number','increment',[21,31])
        updated=next(x for x in inventory if x['program_id']==h['program_id'])
        self.assertLess(updated['score'],old_score)
        self.assertEqual(self.engine.discovery_patterns.inventory('number','increment'),before)
        runtime.feedback([20,30],[21,31],h['program'],'number','test:second','increment',[21,31])
        self.assertEqual(len(runtime.outcomes('number','increment')),2)
        self.assertFalse(runtime.outcomes('number','double'))
    def test_bounds_context_and_empty_goal(self):
        self.train();runtime=self.engine.pattern_runtime
        shallow=runtime.plan([20,30],[42,62],'number',['increment','double'],max_depth=1)
        self.assertEqual(shallow['status'],'bounded')
        unknown=runtime.plan([20,30],[42,62],'number',['unknown'])
        self.assertEqual(unknown['status'],'unreachable_with_selected_hypotheses')
        empty=runtime.plan([],[],'number',['unknown'])
        self.assertEqual(empty['status'],'predicted_goal_matched')
        for args in ({'max_depth':True},{'max_nodes':0},{'max_units':1}):
            with self.assertRaises(ValueError):runtime.plan([20,30],[42,62],'number',['increment'],**args)
        selected=runtime.select([20,30],'number','increment',[999])
        self.assertEqual(selected['status'],'goal_unmet')
        self.assertTrue(selected['candidates']);self.assertFalse(selected['preferred'])
    def test_feedback_validation(self):
        self.train()
        with self.assertRaises(ValueError):self.engine.pattern_runtime.feedback([1],[2],[],'number','source','increment')
    def test_feedback_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            path=os.path.join(folder,'memory.sqlite');first=Engine(database=path);self.train(first)
            program=first.pattern_runtime.select([20,30],'number','increment')['preferred'][0]['hypotheses'][0]['program']
            first.pattern_runtime.feedback([20,30],[21,31],program,'number','observed','increment')
            outcomes=first.pattern_runtime.outcomes('number','increment');first.close()
            second=Engine(database=path)
            try:self.assertEqual(second.pattern_runtime.outcomes('number','increment'),outcomes)
            finally:second.close()
    def test_api(self):
        from app import Application
        self.train();app=Application(self.engine)
        selected=app.dispatch({'action':'pattern_select','units':[20,30],'level':'number','context':'increment','goal':[21,31]})
        program=selected['preferred'][0]['hypotheses'][0]['program']
        app.dispatch({'action':'pattern_feedback','units':[20,30],'actual':[21,31],'program':program,'level':'number','source':'observed','context':'increment'})
        self.assertEqual(len(app.dispatch({'action':'pattern_outcomes','level':'number','context':'increment'})['outcomes']),1)
        self.assertEqual(app.dispatch({'action':'pattern_plan','units':[20,30],'target':[42,62],'level':'number','contexts':['increment','double'],'max_depth':2})['status'],'predicted_goal_matched')
