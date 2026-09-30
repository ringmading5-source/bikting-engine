import tempfile
import unittest
from pathlib import Path
from knowledge import *
from legacy_core import Engine

class KnowledgeTests(unittest.TestCase):
    def test_html(self):
        r = parse_source('<title>Cells</title><script>evil()</script><style>hidden</style><p>Cells use energy.</p>', 'text/html', 'https://example.org')
        self.assertEqual(r['title'], 'Cells')
        self.assertEqual(r['text'], 'Cells use energy.')
    def test_dedup_and_versions(self):
        m = KnowledgeMemory(':memory:')
        r = parse_source('cell energy', 'text/plain', 'test')
        self.assertEqual(m.ingest(r), m.ingest(r))
        m.ingest(parse_source('cell membrane', 'text/plain', 'test'))
        self.assertEqual(len(m.search('cell')), 2)
        m.close()
    def test_retrieval_is_not_verification(self):
        m = KnowledgeMemory(':memory:')
        m.ingest(parse_source('Cells contain membranes.', 'text/plain', 'test'))
        e = Engine(knowledge=m)
        hit = e.retrieve_knowledge('membranes')[0]
        self.assertFalse(hit['verified'])
        self.assertEqual(hit['source'], 'test')
        self.assertFalse(e.transitions)
        self.assertFalse(m.search('unknown'))
        m.close()
    def test_local_persistence(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)/'source.json'; p.write_text('{"name":"Dinka","value":42}')
            db = str(Path(d)/'memory.db')
            m = KnowledgeMemory(db); m.ingest_file(p); m.close()
            m = KnowledgeMemory(db)
            self.assertEqual(len(m.search('Dinka')), 1)
            m.close()
    def test_robots_denied(self):
        class Fake(WebScraper):
            def fetch(self, url): return b'User-agent: *\nDisallow: /', 'text/plain', 'utf-8'
        with self.assertRaisesRegex(ValueError, 'disallows'): Fake().scrape('https://example.org/page')
    def test_web_fake(self):
        class Fake(WebScraper):
            def fetch(self, url):
                if url.endswith('robots.txt'): return b'User-agent: *\nAllow: /', 'text/plain', 'utf-8'
                return b'<p>Biology cells</p>', 'text/html', 'utf-8'
        m = KnowledgeMemory(':memory:')
        m.ingest_web('https://example.org/page', Fake())
        self.assertEqual(len(m.search('biology')), 1)
        m.close()
    def test_bad_inputs(self):
        with self.assertRaises(ValueError): WebScraper().validate_url('file:///etc/passwd')
        with self.assertRaises(ValueError): parse_source('', 'text/plain', 'test')
        with self.assertRaises(ValueError): parse_source('broken', 'application/json', 'test')

if __name__ == '__main__': unittest.main()
