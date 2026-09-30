import unittest
import tempfile
from pathlib import Path
from engine import Engine
from app import Application
class WordTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:');self.w=self.e.words
    def tearDown(self):self.e.close()
    def leaf(self,text,amount=2):self.w.register(text,intent={'operation':'add','amount':amount})
    def test_word_start_and_fixed_point(self):
        result=Application(self.e).dispatch({'action':'word_demo','value':100})
        self.assertEqual(result['decoded'],108);self.assertTrue(result['stabilized']);self.assertEqual(result['index']['word_count'],3)
        self.assertEqual([w['text'] for w in result['words']],['increase','four','times'])
        self.assertEqual(result['trace'][-1]['before'],result['trace'][-1]['after'])
    def test_word_spans_order_and_whitespace(self):
        self.leaf('first',2);self.leaf('last',3)
        result=self.w.execute(' first\t last ',100)
        self.assertEqual(result['decoded'],105);self.assertEqual([a['amount'] for a in result['actions']],[2,3])
    def test_no_inside_word_split(self):
        self.leaf('a');self.leaf('b')
        self.assertEqual(self.w.resolve('ab',100)['status'],'unknown')
    def test_endpoint_collision(self):
        self.leaf('first middle last')
        self.assertEqual(self.w.resolve('first other last',100)['status'],'unknown')
    def test_unknown_and_conflicts(self):
        self.leaf('a',2);self.leaf('a',3)
        self.assertEqual(self.w.resolve('a',100)['status'],'ambiguous')
        self.assertEqual(self.w.resolve('unknown',100)['status'],'unknown')
    def test_cycle_not_stability(self):
        self.w.register('a',children=['b']);self.w.register('b',children=['a'])
        self.assertEqual(self.w.resolve('a',100)['status'],'cycle')
        self.w.register('self',children=['self'])
        self.assertEqual(self.w.resolve('self',100)['status'],'unknown')
    def test_bounds_and_incoherence(self):
        self.leaf('a');self.w.register('root',children=['a','a'])
        self.assertEqual(self.w.resolve('root',100,max_rounds=1)['status'],'bounded')
        self.assertEqual(self.w.resolve('root',100,max_actions=1)['status'],'bounded')
        self.assertEqual(self.w.resolve('a','text')['status'],'incoherent')
        self.assertEqual(self.w.resolve('a',2**63-1)['status'],'incoherent')
        self.assertEqual(self.e.db.execute('SELECT COUNT(*) FROM stable_word_intents').fetchone()[0],0)
    def test_unicode_bytes_and_punctuation(self):
        self.leaf('你好');result=self.w.execute('你好',100)
        self.assertEqual(result['decoded'],102);self.assertEqual(result['words'][0]['hex'],'你好'.encode().hex())
        self.assertEqual(self.w.resolve('你好!',100)['status'],'unknown')
    def test_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            path=str(Path(folder)/'memory.sqlite3');e=Engine(database=path);Application(e).dispatch({'action':'word_demo'});e.close()
            e=Engine(database=path);self.assertEqual(e.words.execute('increase four times',200)['decoded'],208);e.close()
    def test_ambiguous_partition(self):
        for text in ('a','a b','b c','c'):self.leaf(text)
        self.assertEqual(self.w.resolve('a b c',100)['status'],'ambiguous')
