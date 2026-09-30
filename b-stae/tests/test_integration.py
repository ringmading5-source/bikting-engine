import tempfile
from pathlib import Path
import unittest
from core import *
from engine import Engine
from knowledge import WebScraper

class IntegrationTests(unittest.TestCase):
    def test_source_binary_transform_persist(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'notes.txt';p.write_text('Cell contains membrane.',encoding='utf-8')
            db=str(Path(d)/'memory.sqlite3')
            op=Instruction(APPEND,1,b'\nDerived annotation.')
            e=Engine([op],db);sid=e.ingest_file(p)
            initial=e.source_state(sid)
            self.assertEqual(initial.get(1).payload,p.read_bytes())
            target=initial.replace(Record(1,UTF8,p.read_bytes()+op.parameters))
            result=e.transform_source(sid,target,max_depth=1)
            self.assertTrue(result.accepted)
            self.assertEqual(result.snapshots[-1],target.encode())
            self.assertEqual(e.source_state(sid).encode(),initial.encode())
            self.assertEqual(e.retrieve_knowledge('membrane')[0]['binary_state'],initial.encode())
            e.close()
            e=Engine(database=db)
            self.assertEqual(e.source_state(sid).encode(),initial.encode());e.close()
    def test_scraper_feeds_binary_memory(self):
        class Fake(WebScraper):
            def fetch(self,url):
                if url.endswith('robots.txt'):return b'User-agent: *\nAllow: /','text/plain','utf-8'
                return b'<p>Color red</p>','text/html','utf-8'
        e=Engine(database=':memory:')
        sid=e.ingest_web('https://example.org/page',Fake())
        self.assertEqual(e.source_state(sid).get(1).payload,b'Color red');e.close()
    def test_corruption_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'n.txt';p.write_text('data')
            e=Engine(database=':memory:');sid=e.ingest_file(p)
            e.db.execute('UPDATE binary_sources SET state=? WHERE source_id=?',(b'corrupt',sid))
            with self.assertRaises(ValueError):e.source_state(sid)
            e.close()
    def test_original_source_migration(self):
        e=Engine(database=':memory:')
        from knowledge import parse_source
        sid=e.knowledge.ingest(parse_source('data','text/plain','fixture'))
        self.assertEqual(e.migrate_sources(),1)
        self.assertEqual(e.source_state(sid).get(1).payload,b'data');e.close()

if __name__=='__main__':unittest.main()
