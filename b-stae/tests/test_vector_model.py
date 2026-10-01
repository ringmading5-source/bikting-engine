import unittest
import tempfile
from pathlib import Path
from engine import Engine
from app import Application
from vector_experiment import dataset
from vector_model import route
class VectorTests(unittest.TestCase):
    def setUp(self):
        self.e=Engine(database=':memory:');self.m=self.e.vector_model
        self.train,self.test=dataset();self.report=self.m.train('grid',self.train,self.test)
    def tearDown(self):self.e.close()
    def test_holdout_beats_retrieval(self):
        ev=self.report['evaluation'];self.assertLess(ev['forward_mse'],1e-12)
        self.assertGreater(ev['nearest_neighbor_mse'],0.1);self.assertEqual(ev['exact_lookup_coverage'],0)
        self.assertLess(ev['backward_mse'],1e-12)
    def test_predict_not_verified(self):
        r=self.m.predict('grid',[0,0],'displacement','east',[1]);self.assertAlmostEqual(r['state'][0],1)
        self.assertFalse(r['verified']);self.assertIsNone(r['confidence'])
    def test_unknown_range_dimensions(self):
        self.assertEqual(self.m.predict('grid',[0,0],'displacement','fly',[1])['status'],'unknown')
        self.assertEqual(self.m.predict('grid',[100,0],'displacement','east',[1])['status'],'unsupported')
        for v in ([0],[float('nan'),0]):
            with self.assertRaises(ValueError):self.m.predict('grid',v,'displacement','east',[1])
    def test_leakage(self):
        with self.assertRaises(ValueError):self.m.train('bad',self.train,[self.train[0]])
    def test_plan_budget(self):
        actions=[{'relation':'displacement','behavior':b,'context':[1],'min':[-4,-4],'max':[4,4]} for b in ('east','north','west')]
        r=self.m.plan('grid',[0,0],[2,2],actions,max_depth=4)
        self.assertEqual(r['status'],'predicted_goal');self.assertEqual(len(r['path']),4)
        self.assertEqual(r['timeline'][0]['channels'],['visual','voice','text']);self.assertFalse(r['verified'])
        self.assertEqual(self.m.plan('grid',[0,0],[2,2],actions,max_expansions=1)['status'],'budget')
        self.assertEqual(self.m.plan('grid',[0,0],[2,2],actions,max_depth=0)['status'],'unresolved')
    def test_observation_correction(self):
        a={'relation':'displacement','behavior':'east','context':[1]}
        self.assertEqual(self.m.verify('grid',[0,0],a,[1,0])['status'],'verified')
        self.assertEqual(self.m.verify('grid',[0,0],a,[0,0])['status'],'corrected')
    def test_routes(self):
        for n in range(8):self.assertEqual(len(route(format(n,'03b'),0,[0])['channels']),n.bit_count())
        with self.assertRaises(ValueError):route('abc',0,[0])
    def test_persistence_api(self):
        with tempfile.TemporaryDirectory() as folder:
            path=str(Path(folder)/'memory.db');e=Engine(database=path)
            Application(e).dispatch({'action':'vector_train','name':'grid','training':self.train,'validation':self.test});e.close();e=Engine(database=path)
            try:
                r=Application(e).dispatch({'action':'vector_predict','name':'grid','state':[0,0],'relation':'displacement','behavior':'north','context':[2]});self.assertAlmostEqual(r['state'][1],2)
            finally:e.close()
    def test_rank_deficient_abstains(self):
        rows=[dict(self.train[0],before=[i,0],after=[i+1,0]) for i in range(3)]
        self.m.train('thin',rows,[dict(rows[0],before=[0.5,0],after=[1.5,0])])
        self.assertEqual(self.m.predict('thin',[0.5,0],'displacement',rows[0]['behavior'],[1])['status'],'unsupported')
