import unittest
from engine import Engine

class ExpandedDiscoveryTests(unittest.TestCase):
    def setUp(self):self.engine=Engine(database=':memory:')
    def tearDown(self):self.engine.close()
    def check(self, train, unseen, oracle, context, **bounds):
        for index,units in enumerate(train):
            self.engine.patterns.learn_pair(units,oracle(units),'generic',f'train:{index}',context)
        report=self.engine.discovery_patterns.discover('generic',context,**bounds)
        result=self.engine.discovery_patterns.predict(unseen,'generic',context)
        matched=[c for c in result['candidates'] if c['units']==oracle(unseen)]
        self.assertTrue(matched)
        self.assertTrue(any(len(h['supporting'])==len(train) for h in matched[0]['hypotheses']))
        return report,result
    def test_skipping_and_offsets(self):
        train=[list(x) for x in ('abcde','fghijkl','mnopqrstuv')]
        for stride in (2,3,4):
            self.check(train,list('ABCDEFGHIJKL'),lambda x:x[::stride],{'stride':stride})
        self.check(train,list('ABCDEFGHIJKL'),lambda x:x[3:],{'offset':3})
    def test_three_parts(self):
        self.check([list(x) for x in ('abcde','fghijkl','mnopqrstuv')],list('ABCDEFGHIJKL'),
                   lambda x:x[:1]+x[-1:]+x[1:-1],{'task':'three'},max_parts=3,max_programs=4096)
    def test_numeric_parameters_and_quadratics(self):
        train=[[1,3,5],[-2,4,7,9],[0,2,6,8,11]]
        for name,func in [('shift',lambda x:x+7),('scale',lambda x:3*x),('affine',lambda x:2*x-5),
                          ('square',lambda x:x*x),('quadratic',lambda x:2*x*x-3*x+4),('fraction',lambda x:x/2)]:
            self.check(train,[-11,13,17,21,25,29],lambda units:[func(x) for x in units],{'numeric':name})
    def test_numeric_contradictions_retained(self):
        self.check([[1,2,3],[4,5,6,7]],[8,9,10,11,12],lambda x:[2*v for v in x],{'numeric':True})
        old=self.engine.discovery_patterns.inventory('generic',{'numeric':True})
        self.engine.patterns.learn_pair([8,9,10],[99,99,99],'generic','failed',{'numeric':True})
        new=self.engine.discovery_patterns.inventory('generic',{'numeric':True})
        self.assertEqual(len(old),len(new))
        self.assertTrue(any(h['eligible'] and h['conflicting'] for h in new))
        self.assertEqual(self.engine.patterns.stats()['examples'],3)
    def test_type_guards_and_limits(self):
        self.check([[1,2,3],[4,5,6,7]],[8,9,10,11,12],lambda x:[2*v+10 for v in x],None)
        self.assertEqual(self.engine.discovery_patterns.predict(['a','b','c'],'generic')['status'],'unknown')
        for kwargs in ({'max_stride':0},{'max_stride':True},{'endpoint_radius':9}):
            with self.assertRaises(ValueError):self.engine.discovery_patterns.discover('generic',**kwargs)
