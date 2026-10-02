import tempfile
import unittest
from pathlib import Path
from engine import Engine
from bstae import Model
from behavior_composition_demo import run,train,state

class CompositionTests(unittest.TestCase):
    def test_unseen_without_complete_training_paths(self):
        r=run()
        self.assertEqual((r['correct'],r['total'],r['training_pairs'],r['supplied_complete_trajectories']),(200,200,6,0))
        self.assertEqual(r['remembered']['source'],'reverified_memory')
        self.assertEqual(r['counterevidence']['status'],'contested')
        self.assertFalse(r['remembered']['verified_world_outcome'])
    def test_text_composition_without_joint_examples(self):
        e=Engine(database=':memory:')
        try:
            for x in ('cat','dog','bird'):e.behavior.observe({'phase':'start','text':x},{'phase':'middle','text':x+'!'},'synthetic','suffix')
            for x in ('book','tree','rock'):e.behavior.observe({'phase':'middle','text':x},{'phase':'end','text':'['+x+']'},'synthetic','bracket')
            for value in ('copper','new word','猫猫猫','sample42'):
                r=e.composition.solve({'phase':'start','text':value},{'phase':'end','text':'['+value+'!]'},['bracket','suffix'])
                self.assertEqual(r['status'],'goal_satisfied')
                self.assertEqual([p['context'] for p in r['plan']],['suffix','bracket'])
        finally:e.close()
    def test_bounds_gaps_and_identity(self):
        e=Engine(database=':memory:')
        try:
            train(e);initial=state('new','start',100);target=state('new','end',210)
            self.assertEqual(e.composition.solve(initial,target,['offset','scale'],max_depth=1)['status'],'bounded')
            self.assertEqual(e.composition.solve(initial,target,['offset','scale'],max_nodes=1)['status'],'bounded')
            self.assertEqual(e.composition.solve(initial,target,['missing'])['status'],'knowledge_gap')
            self.assertEqual(e.composition.solve(initial,state('new','end',211),['offset','scale'])['status'],'unsolved')
            self.assertEqual(e.composition.solve(initial,initial,['offset'],max_depth=0)['plan'],[])
        finally:e.close()
    def test_restart_via_sdk(self):
        with tempfile.TemporaryDirectory() as d:
            with Model() as m:
                train(m.components)
                payload={'initial':state('new','start',100),'target':state('new','end',210),'contexts':['offset','scale']}
                self.assertEqual(m.request('behavior_compose',**payload)['status'],'goal_satisfied')
                m.save(Path(d)/'checkpoint')
            with Model.load(Path(d)/'checkpoint') as m:
                r=m.request('behavior_compose',**payload)
                self.assertEqual(r['source'],'reverified_memory')
                self.assertEqual(r['result'],payload['target'])
    def test_validation_and_corrupt_plan(self):
        e=Engine(database=':memory:')
        try:
            train(e);initial=state('new','start',100);target=state('new','end',210)
            with self.assertRaises(ValueError):e.composition.solve(initial,target,[])
            with self.assertRaises(ValueError):e.composition.solve(initial,target,['offset'],max_depth=True)
            e.composition.solve(initial,target,['offset','scale'])
            with e.db:e.db.execute("UPDATE composed_behavior_plans SET path='[]'")
            with self.assertRaises(ValueError):e.composition.solve(initial,target,['offset','scale'])
        finally:e.close()
