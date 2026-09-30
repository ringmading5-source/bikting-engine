import json
import unittest
from engine import Engine
from intent_bridge import IntentBridge
from knowledge import parse_source
from core import decode_outputs

class BridgeTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:');self.b=IntentBridge(self.e)
    def tearDown(self):self.e.close()
    def rule(self,operand=2):return {'request':'increase','representation':'int64','operation':'add','operand':operand,'steps':1}
    def ingest(self,rules,source='fixture'):
        sid=self.e.knowledge.ingest(parse_source(json.dumps({'recipes':rules}),'application/json',source));self.e.encode_source(sid)
    def test_goal_from_request_without_target(self):
        self.ingest([self.rule()]);status,plan,result=self.b.fulfill(3,'increase')
        self.assertEqual(status['status'],'verified');self.assertEqual(decode_outputs(plan.target.state)[1],5)
        self.assertEqual(self.b.fulfill(3,'increase')[0]['resolution'],'persistent_memory')
        self.assertEqual(self.e.instructions,())
    def test_unknown(self):self.assertEqual(self.b.fulfill(3,'unknown')[0]['status'],'unsupported')
    def test_conflict(self):
        self.ingest([self.rule()],'a');self.ingest([self.rule(4)],'b')
        self.assertEqual(self.b.fulfill(3,'increase')[0]['status'],'ambiguous')
        self.assertEqual(self.e.paths.stats()['verified_paths'],0)
    def test_permission_and_depth(self):
        self.ingest([self.rule()])
        self.assertEqual(self.b.fulfill(3,'increase',allowed=frozenset())[0]['status'],'denied')
        self.assertEqual(self.b.fulfill(3,'increase',max_depth=0)[0]['status'],'bounded')
    def test_invalid_atomic(self):
        bad=self.rule();bad['operation']='execute_shell'
        self.ingest([self.rule(),bad])
        status,_,_=self.b.fulfill(3,'increase');self.assertEqual(status['status'],'unsupported')
        self.assertTrue(status['invalid_sources'])
    def test_latest_and_overflow(self):
        self.ingest([self.rule()]);self.ingest([self.rule(4)])
        self.assertEqual(decode_outputs(self.b.fulfill(3,'increase')[1].target.state)[1],7)
        self.assertEqual(self.b.fulfill(2**63-1,'increase')[0]['status'],'invalid')
    def test_text_and_color(self):
        self.ingest([{'request':'excited','representation':'utf8','operation':'append','operand':'!','steps':2},
                     {'request':'redder','representation':'rgb24','operation':'shift','operand':[10,0,0],'steps':1}])
        self.assertEqual(decode_outputs(self.b.fulfill('Hi','excited')[1].target.state)[1],'Hi!!')
        self.assertEqual(decode_outputs(self.b.fulfill('#000000','redder')[1].target.state)[1]['hex'],'#0a0000')

if __name__=='__main__':unittest.main()
