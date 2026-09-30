import tempfile
import struct
import unittest
from pathlib import Path
from core import Instruction,ADD
from engine import Engine
from path_memory import encode_program,decode_program

class PersistentPathTests(unittest.TestCase):
    def operation(self):return Instruction(ADD,1,struct.pack('<q',2))
    def test_restart_and_reinforcement(self):
        with tempfile.TemporaryDirectory() as d:
            db=str(Path(d)/'memory.db')
            e=Engine([self.operation()],db)
            self.assertEqual(e.transform(3,7,max_depth=2).source,'composition')
            e.close()
            e=Engine([self.operation()],db)
            r=e.transform(3,7,max_depth=2)
            self.assertTrue(r.accepted);self.assertEqual(r.source,'persistent_memory')
            self.assertEqual(e.paths.stats()['successful_executions'],2);e.close()
    def test_context_permissions_target_and_operations(self):
        with tempfile.TemporaryDirectory() as d:
            db=str(Path(d)/'memory.db')
            e=Engine([self.operation()],db);e.transform(3,7,max_depth=2);e.close()
            e=Engine([self.operation()],db)
            self.assertFalse(e.transform(3,7,max_depth=2,allowed=frozenset()).accepted)
            self.assertFalse(e.transform(3,8,max_depth=2).accepted)
            self.assertFalse(e.transform(3,7,max_depth=1).accepted);e.close()
            e=Engine([],db)
            self.assertFalse(e.transform(3,7,max_depth=2).accepted);e.close()
    def test_corruption_recomposed(self):
        e=Engine([self.operation()],':memory:');e.transform(3,7,max_depth=2)
        e.db.execute('UPDATE binary_paths SET program=?',(b'bad',));e.db.commit()
        result=e.transform(3,7,max_depth=2)
        self.assertTrue(result.accepted);self.assertNotEqual(result.source,'persistent_memory')
        self.assertEqual(e.paths.stats()['verified_paths'],1);e.close()
    def test_failed_not_promoted(self):
        e=Engine([self.operation()],':memory:')
        self.assertFalse(e.transform(3,8,max_depth=2).accepted)
        self.assertEqual(e.paths.stats()['verified_paths'],0);e.close()
    def test_valid_bytes_invalid_program_rejected(self):
        import hashlib
        e=Engine([self.operation()],':memory:');e.transform(3,7,max_depth=2)
        bad=encode_program(())
        e.db.execute('UPDATE binary_paths SET program=?,sha256=?',(bad,hashlib.sha256(bad).hexdigest()));e.db.commit()
        self.assertTrue(e.transform(3,7,max_depth=2).accepted)
        self.assertEqual(e.paths.stats()['verified_paths'],1);e.close()
    def test_codec(self):
        p=(self.operation().encode(),)*2
        self.assertEqual(decode_program(encode_program(p),2),p)
        with self.assertRaises(ValueError):decode_program(encode_program(p),1)
        self.assertEqual(decode_program(encode_program(()),0),())

if __name__=='__main__':unittest.main()
