import tempfile
from pathlib import Path
import unittest
from engine import Engine
class ModalityTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:')
    def tearDown(self):self.e.close()
    def test_explicit_sources_and_formats(self):
        for value,intent,current,expected in [(3,'add 2',100,102),('Hi','append "!"','Yo','Yo!')]:
            stored=self.e.modalities.register(value,intent,'runbook:v1')
            self.assertEqual(self.e.modalities.transform(current,stored['program'])['decoded'],expected)
            self.assertEqual(stored['source'],'runbook:v1')
        with self.assertRaises(ValueError):self.e.modalities.register(3,'add 2','')
    def test_integrity_context_and_overflow(self):
        stored=self.e.modalities.register(3,'add 2','runbook:v1')
        with self.assertRaises(ValueError):self.e.modalities.transform('text',stored['program'])
        with self.assertRaises(OverflowError):self.e.modalities.transform(2**63-1,stored['program'])
        self.e.db.execute("UPDATE stored_modality_programs SET program_hash='bad'")
        with self.assertRaises(ValueError):self.e.modalities.transform(3,stored['program'])
    def test_restart_and_old_inferred_programs_ignored(self):
        with tempfile.TemporaryDirectory() as folder:
            path=str(Path(folder)/'memory.db');e=Engine(database=path)
            e.db.execute('CREATE TABLE modality_programs (fingerprint TEXT)')
            e.db.execute("INSERT INTO modality_programs VALUES ('old-inferred')")
            stored=e.modalities.register(3,'add 2','runbook:v1');e.close();e=Engine(database=path)
            self.assertEqual(len(e.modalities.programs()),1)
            self.assertEqual(e.modalities.transform(100,stored['program'])['decoded'],102);e.close()
