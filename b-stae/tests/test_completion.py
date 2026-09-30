import json
import tempfile
from pathlib import Path
import struct
import unittest
from engine import Engine
from core import *
from byte_relationships import *
from knowledge import parse_source

class CompletionTests(unittest.TestCase):
    def rule(self):return Relationship(10,(Guard(1,INT64,signature=struct.pack('<q',1),mask=b'\xff'*8,length=8),Guard(2,RGB,length=3)),(Effect(2,RGB,(Fragment(literal=b'\xff\x00\x00'),)),))
    def source(self,e,bad=False):
        before=BinaryState((Record(1,INT64,struct.pack('<q',1)),Record(2,RGB,b'\x00'*3)))
        after=self.rule().apply(before) if not bad else before
        data={'byte_relationships':[{'definition':json.loads(self.rule().encode()[9:]),'observations':[{'before':before.encode().hex(),'after':after.encode().hex()}]}]}
        sid=e.knowledge.ingest(parse_source(json.dumps(data),'application/json','fixture'));e.encode_source(sid);return sid
    def test_import_bind_different_ids_persist(self):
        with tempfile.TemporaryDirectory() as d:
            db=str(Path(d)/'m.db');e=Engine(database=db)
            sid=self.source(e);self.assertEqual(e.relationship_sources.import_source(sid),[10])
            result=e.interact({20:1,30:'#000000'},{20:1,30:'#ff0000'})
            self.assertTrue(result.accepted);self.assertEqual(result.program[0][1],((1,20),(2,30)))
            self.assertEqual(e.relationship_sources.provenance()[0]['source_id'],sid);e.close()
            e=Engine(database=db);self.assertEqual(e.interact({20:1,30:'#000000'},{20:1,30:'#ff0000'}).source,'bound_relationship_memory');e.close()
    def test_bad_observation_no_rule(self):
        e=Engine(database=':memory:');sid=self.source(e,True)
        with self.assertRaises(ValueError):e.relationship_sources.import_source(sid)
        self.assertFalse(e.relationships.load());e.close()
    def test_binding_multiple_candidates(self):
        e=Engine(database=':memory:');e.relationships.register(self.rule())
        result=e.interact({4:0,5:1,6:'#000000',7:'#000000'},{4:0,5:1,6:'#000000',7:'#ff0000'},max_depth=1)
        self.assertTrue(result.accepted);self.assertEqual(dict(result.program[0][1]),{1:5,2:7});e.close()
    def test_bounds_and_permissions(self):
        e=Engine(database=':memory:');e.relationships.register(self.rule())
        self.assertFalse(e.interact({20:1,30:'#000000'},{20:1,30:'#ff0000'},allowed=frozenset()).accepted)
        self.assertFalse(e.interact({20:1,30:'#000000'},{20:1,30:'#ff0000'},max_depth=0).accepted);e.close()

if __name__=='__main__':unittest.main()
