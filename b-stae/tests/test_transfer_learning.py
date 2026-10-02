import tempfile
import unittest
from pathlib import Path
from engine import Engine
from bstae import Model
from transfer_learning_demo import run,align
from behavior_composition_demo import train,state

class TransferTests(unittest.TestCase):
    def test_transfer_and_exclusions(self):
        r=run()
        self.assertEqual((r['correct'],r['total'],r['behavior_training_pairs'],r['alignment_pairs']),(300,300,6,9))
        self.assertEqual(r['missing_conditions']['status'],'needs_information')
        self.assertEqual(r['incompatible_conditions']['status'],'not_applicable')
        self.assertEqual(r['after_feedback']['status'],'contested')
    def test_non_numeric_transfer_and_unknown_bindings(self):
        e=Engine(database=':memory:')
        try:
            for x in ('cat','dog','bird'):e.behavior.observe({'phase':'start','text':x},{'phase':'middle','text':x+'!'},'synthetic','suffix')
            for x in ('book','tree','rock'):e.behavior.observe({'phase':'middle','text':x},{'phase':'end','text':'['+x+']'},'synthetic','bracket')
            examples=[{'domain':{'stage':phase,'message':text},'canonical':{'phase':phase,'text':text}} for phase,text in [('start','cat'),('middle','dog'),('end','bird')]]
            learned=e.transfer.learn(examples,{'format':'plain'},['suffix','bracket'],'synthetic')
            r=e.transfer.solve({'stage':'start','message':'unseen text'},{'stage':'end','message':'[unseen text!]'},learned['adapter'],{'format':'plain'})
            self.assertEqual(r['result'],{'stage':'end','message':'[unseen text!]'})
            self.assertEqual(e.transfer.solve({'stage':'start'},{'stage':'end'},learned['adapter'],{'format':'plain'})['status'],'needs_information')
            self.assertEqual(e.transfer.solve({}, {},'unknown',{})['status'],'needs_information')
        finally:e.close()
    def test_ambiguous_mapping_and_no_reactivation(self):
        e=Engine(database=':memory:')
        try:
            examples=[{'domain':{'a':x,'b':x},'canonical':{'x':x,'y':x}} for x in (1,2,3)]
            self.assertEqual(e.transfer.learn(examples,{'ok':True},['one'],'synthetic')['status'],'ambiguous')
            train(e);adapter=align(e,('who','stage','amount'))
            counter={'domain':{'who':'new','stage':'start','amount':10},'canonical':state('new','start',99)}
            e.transfer.feedback(adapter,counter,'synthetic')
            self.assertFalse(e.transfer.get(adapter)[1])
            good={'domain':counter['domain'],'canonical':state('new','start',10)}
            self.assertFalse(e.transfer.feedback(adapter,good,'synthetic:good')['active'])
        finally:e.close()
    def test_condition_types_and_state_schema(self):
        e=Engine(database=':memory:')
        try:
            train(e);adapter=align(e,('who','stage','amount'))
            initial={'who':'new','stage':'start','amount':100};target=dict(initial,stage='end',amount=210)
            self.assertEqual(e.transfer.solve(initial,target,adapter,{'simulation':1,'unit_system':'abstract'})['status'],'not_applicable')
            self.assertEqual(e.transfer.solve(dict(initial,extra='x'),target,adapter,{'simulation':True,'unit_system':'abstract'})['status'],'not_applicable')
            self.assertEqual(e.transfer.solve(initial,target,adapter,{'simulation':True,'unit_system':'abstract'},max_depth=1)['status'],'bounded')
        finally:e.close()
    def test_checkpoint_and_api(self):
        with tempfile.TemporaryDirectory() as d:
            with Model() as m:
                train(m.components);adapter=align(m.components,('who','stage','amount'));m.save(Path(d)/'checkpoint')
            with Model.load(Path(d)/'checkpoint') as m:
                r=m.request('transfer_solve',initial={'who':'new','stage':'start','amount':100},target={'who':'new','stage':'end','amount':210},adapter=adapter,conditions={'simulation':True,'unit_system':'abstract'})
                self.assertEqual(r['status'],'goal_satisfied')
                self.assertTrue(r['transfer_applied'])
                self.assertFalse(r['verified_world_outcome'])
