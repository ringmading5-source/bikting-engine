import unittest
import tempfile
from pathlib import Path
from engine import Engine
from app import Application

class RecursiveTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:');self.r=self.e.recursion
    def tearDown(self):self.e.close()
    def terminal(self,value,amount=2):self.r.register(value,intent={'operation':'add','amount':amount})
    def test_nested_execution(self):
        self.terminal('leaf');self.r.register('branch',children=['leaf','leaf']);self.r.register('root',children=['branch','branch'])
        result=self.r.execute('root',100)
        self.assertEqual(result['decoded'],108);self.assertEqual(len(result['actions']),4);self.assertTrue(result['verified'])
        self.assertEqual(max(t['depth'] for t in result['trace']),2)
    def test_endpoints_are_not_identity(self):
        self.terminal('abca')
        result=self.r.resolve('axya');self.assertEqual(result['status'],'unknown')
        self.assertEqual(result['trace'][0]['endpoint_candidates'],1);self.assertEqual(result['trace'][0]['full_matches'],0)
    def test_ordered_subsequences(self):
        self.terminal('ab',2);self.terminal('cd',3)
        result=self.r.execute('abcd',100);self.assertEqual(result['decoded'],105)
        self.assertEqual([x['amount'] for x in result['actions']],[2,3])
    def test_cycles_depth_and_nodes(self):
        self.r.register('a',children=['b']);self.r.register('b',children=['a'])
        self.assertEqual(self.r.resolve('a')['status'],'cycle')
        self.terminal('leaf');self.r.register('middle',children=['leaf']);self.r.register('root',children=['middle'])
        self.assertEqual(self.r.resolve('root',max_depth=1)['status'],'bounded')
        self.assertEqual(self.r.resolve('root',max_nodes=1)['status'],'bounded')
    def test_ambiguity(self):
        self.terminal('leaf',2);self.terminal('leaf',3)
        self.assertEqual(self.r.resolve('leaf')['status'],'ambiguous')
    def test_ambiguous_partition(self):
        for text in ('a','ab','bc','c'):self.terminal(text)
        self.assertEqual(self.r.resolve('abc')['status'],'ambiguous')
    def test_numeric_and_audio_keys(self):
        self.terminal(123)
        self.assertEqual(self.r.execute(123,3)['decoded'],5)
        audio=lambda rate:{'audio':{'samples':[1,2],'sample_rate':rate}}
        self.terminal(audio(8000))
        self.assertEqual(self.r.resolve(audio(16000))['status'],'unknown')
    def test_preflight_and_actions_bound(self):
        self.terminal('leaf');self.r.register('root',children=['leaf','leaf'])
        with self.assertRaises(OverflowError):self.r.execute('root',2**63-4)
        self.assertEqual(self.e.db.execute('SELECT COUNT(*) FROM intent_paths').fetchone()[0],0)
        self.assertEqual(self.r.resolve('root',max_actions=1)['status'],'bounded')
    def test_app_and_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            path=str(Path(folder)/'memory.sqlite3');e=Engine(database=path)
            self.assertEqual(Application(e).dispatch({'action':'recursive_demo','value':100})['decoded'],108);e.close()
            e=Engine(database=path);self.assertEqual(e.recursion.execute('increase-eight',200)['decoded'],208);e.close()
    def test_idempotency_and_unknown(self):
        self.terminal('leaf');self.terminal('leaf')
        self.assertEqual(self.r.resolve('leaf')['status'],'resolved')
        self.assertEqual(self.r.execute('missing',100)['status'],'unknown')
