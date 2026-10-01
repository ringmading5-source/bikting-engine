from pathlib import Path
import unittest
from engine import Engine
from session import command,participants

class SessionTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:')
    def tearDown(self):self.e.close()
    def test_complete_flow_and_idempotent_import(self):
        path=Path(__file__).resolve().parents[1]/'examples/byte-relationships.json'
        self.assertEqual(command(self.e,'import file '+str(path))['imported'],[100,101])
        self.assertEqual(command(self.e,'import file '+str(path))['imported'],[100,101])
        line='interact {"20":1,"30":"#000000","40":"Ready"} -> {"20":1,"30":"#ff0000","40":"Ready!"}'
        result=command(self.e,line)
        self.assertTrue(result['accepted']);self.assertEqual(len(result['path']),2)
        self.assertEqual(result['trace'][-1]['decoded'][40],'Ready!')
        self.assertEqual(command(self.e,line)['resolution'],'bound_relationship_memory')
    def test_recognition_and_invalid_command(self):
        self.assertEqual(command(self.e,'recognize 42')['representation'],'int64')
        with self.assertRaises(ValueError):command(self.e,'invent knowledge')
        with self.assertRaises(ValueError):participants('{"01":1}')

if __name__=='__main__':unittest.main()
