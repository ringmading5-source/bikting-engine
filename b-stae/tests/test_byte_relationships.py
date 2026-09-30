import struct
import tempfile
from pathlib import Path
import unittest
from core import *
from engine import Engine
from byte_relationships import *

class RelationshipByteTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:')
    def tearDown(self):self.e.close()
    def test_same_kernel_multiple_representations(self):
        fixtures=[(UTF8,b'Hi',b'!',b'Hi!'),(RGB,b'\x0a\x14\x1e',b'',b'\x1e\x14\x0a'),
                  (PCM16,b'\x01\x00\x02\x00',b'',b'\x02\x00\x01\x00'),(BLOB,b'\x00\xff',b'\x80',b'\x00\xff\x80')]
        for index,(kind,payload,suffix,out) in enumerate(fixtures):
            if kind in (RGB,PCM16):
                width=1 if kind==RGB else 2
                fragments=tuple(Fragment(1,offset,width) for offset in (list(range(len(payload)-width,-1,-width))))
            else:fragments=(Fragment(1),Fragment(literal=suffix))
            rule=Relationship(index,(Guard(1,kind,length=len(payload)),),(Effect(1,kind,fragments),))
            self.e.relationships.register(rule)
            start=BinaryState((Record(1,kind,payload),));goal=BinaryState((Record(1,kind,out),))
            result=self.e.resolve_relationships(start,goal,max_depth=1,allowed=frozenset({index}))
            self.assertTrue(result.accepted)
            self.assertEqual(result.snapshots[-1],goal.encode())
    def test_cross_representation_interaction(self):
        start=BinaryState((Record(1,INT64,struct.pack('<q',1)),Record(2,RGB,b'\x00\x00\x00')))
        rule=Relationship(10,(Guard(1,INT64,signature=struct.pack('<q',1),mask=b'\xff'*8,length=8),Guard(2,RGB,length=3)),
                          (Effect(2,RGB,(Fragment(literal=b'\xff\x00\x00'),)),))
        self.e.relationships.register(rule)
        goal=start.replace(Record(2,RGB,b'\xff\x00\x00'))
        self.assertTrue(self.e.resolve_relationships(start,goal).accepted)
        blocked=start.replace(Record(1,INT64,struct.pack('<q',0)))
        self.assertFalse(self.e.resolve_relationships(blocked,blocked.replace(Record(2,RGB,b'\xff\x00\x00'))).accepted)
    def test_copy_across_types(self):
        start=BinaryState((Record(1,INT64,struct.pack('<q',25)),Record(2,POSITION3,struct.pack('<iii',0,10,0))))
        rule=Relationship(11,(Guard(1,INT64,length=8),Guard(2,POSITION3,length=12)),
            (Effect(2,POSITION3,(Fragment(1,0,4),Fragment(2,4,8))),))
        goal=start.replace(Record(2,POSITION3,struct.pack('<iii',25,10,0)))
        self.e.relationships.register(rule);self.assertTrue(self.e.resolve_relationships(start,goal).accepted)
    def test_composition_and_persistence(self):
        with tempfile.TemporaryDirectory() as d:
            db=str(Path(d)/'m.db');e=Engine(database=db)
            rule=Relationship(1,(Guard(1,UTF8),),(Effect(1,UTF8,(Fragment(1),Fragment(literal=b'!'))),))
            e.relationships.register(rule)
            start=e.recognize('Hi').state;goal=e.recognize('Hi!!').state
            self.assertEqual(e.resolve_relationships(start,goal,max_depth=2).program,(1,1));e.close()
            e=Engine(database=db)
            self.assertEqual(e.resolve_relationships(start,goal,max_depth=2).source,'relationship_memory');e.close()
    def test_typed_invalid_output_and_permissions(self):
        rule=Relationship(1,(Guard(1,UTF8),),(Effect(1,RGB,(Fragment(literal=b'x'),)),))
        self.e.relationships.register(rule)
        start=self.e.recognize('Hi').state;goal=self.e.recognize('#000000').state
        self.assertFalse(self.e.resolve_relationships(start,goal).accepted)
        with self.assertRaises(ValueError):rule.apply(start)
    def test_xor_and_simultaneous_updates(self):
        start=BinaryState((Record(1,BLOB,b'\x00'),Record(2,BLOB,b'\xff')))
        rule=Relationship(1,(Guard(1,BLOB),Guard(2,BLOB)),(Effect(1,BLOB,(Fragment(2),)),Effect(2,BLOB,(Fragment(1),))))
        target=rule.apply(start)
        self.assertEqual(target.get(1).payload,b'\xff');self.assertEqual(target.get(2).payload,b'\x00')
        xor=Relationship(2,(Guard(1,BLOB),),(Effect(1,BLOB,(Fragment(1,0,1,xor=b'\xff'),)),))
        self.assertEqual(xor.apply(start).get(1).payload,b'\xff')
    def test_ordinary_input_interaction(self):
        rule=Relationship(7,(Guard(1,INT64,length=8),Guard(2,RGB,length=3)),
            (Effect(2,RGB,(Fragment(literal=b'\xff\x00\x00'),)),))
        self.e.relationships.register(rule)
        result=self.e.interact({1:1,2:'#000000'},{1:1,2:'#ff0000'},allowed=frozenset({7}))
        self.assertTrue(result.accepted)
    def test_invalid_utf8_rewrite_rejected(self):
        rule=Relationship(8,(Guard(1,UTF8),),(Effect(1,UTF8,(Fragment(literal=b'\xff'),)),))
        with self.assertRaises(ValueError):rule.apply(self.e.recognize('Hi').state)
    def test_corrupt_relation_never_executes(self):
        rule=Relationship(8,(Guard(1,UTF8),),(Effect(1,UTF8,(Fragment(literal=b'!'),)),))
        self.e.relationships.register(rule)
        self.e.db.execute('UPDATE byte_relationships SET rule=?',(b'bad',))
        with self.assertRaises(ValueError):self.e.relationships.load()
    def test_codec(self):
        rule=Relationship(1,(Guard(1,BLOB),),(Effect(1,BLOB,(Fragment(1),)),))
        self.assertEqual(Relationship.decode(rule.encode()),rule)
        with self.assertRaises(ValueError):Relationship.decode(rule.encode()[:-1])
    def test_mask_bounds_and_permission(self):
        rule=Relationship(1,(Guard(1,BLOB,signature=b'\x01',mask=b'\x01'),),(Effect(1,BLOB,(Fragment(literal=b'\x00'),)),))
        self.e.relationships.register(rule)
        start=BinaryState((Record(1,BLOB,b'\x03'),));goal=BinaryState((Record(1,BLOB,b'\x00'),))
        self.assertFalse(self.e.resolve_relationships(start,goal,allowed=frozenset()).accepted)
        self.assertFalse(self.e.resolve_relationships(start,goal,max_depth=0).accepted)
        self.assertTrue(self.e.resolve_relationships(start,goal).accepted)

if __name__=='__main__':unittest.main()
