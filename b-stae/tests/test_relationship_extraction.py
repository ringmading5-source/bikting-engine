import unittest
from engine import Engine
from knowledge import parse_source
from web_intent_loop import WebIntentLoop
class ExtractionTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:')
    def tearDown(self):self.e.close()
    def source(self,text,url='https://example.org/source'):
        sid=self.e.knowledge.ingest(parse_source(text,'text/plain',url));self.e.encode_source(sid);return sid
    def test_general_relations_and_bytes(self):
        text='A cell is a basic biological unit. A cell contains cytoplasm. A cell has 2 membranes. A cell converts nutrients into energy.'
        result=self.e.extraction.extract(self.source(text),'cell');self.assertEqual(result['count'],4)
        inspected=self.e.extraction.inspect('cell');self.assertEqual({r['predicate'] for r in inspected['relations']},{'is_a','contains','has_count','converts'})
        for relation in inspected['relations']:
            evidence=relation['evidence'];self.assertEqual(text[evidence['start']:evidence['end']],evidence['clause'])
        self.assertEqual(len(inspected['state_hex']),4)
    def test_qualifications_retained(self):
        self.e.extraction.extract(self.source('A ball is a round object (usually spherical, but sometimes ovoid).'),'ball')
        relation=self.e.extraction.inspect('ball')['relations'][0];self.assertEqual(relation['assertion'],'qualified');self.assertIn('sometimes',relation['evidence']['clause'])
    def test_count_conflicts(self):
        for count in (2,3):self.e.extraction.extract(self.source(f'A device has {count} ports.',f'https://example.org/{count}'),'device')
        self.assertEqual(self.e.extraction.inspect('device')['conflicts'],[{'item':'ports','counts':[2,3]}])
    def test_subject_precision(self):
        self.assertEqual(self.e.extraction.extract(self.source('Some cell is a unit. A cells is a unit.'),'cell')['count'],0)
        self.assertEqual(self.e.extraction.inspect('cell')['status'],'unknown')
    def test_integrity_and_source_changes(self):
        sid=self.source('A cell is a unit.');self.e.extraction.extract(sid,'cell')
        self.e.db.execute("UPDATE extracted_relations SET state_hash='bad'")
        with self.assertRaises(ValueError):self.e.extraction.inspect('cell')
        self.e.db.execute("UPDATE sources SET sha256='changed'")
        self.assertEqual(self.e.extraction.inspect('cell')['status'],'unknown')
    def test_web_inspection_loop(self):
        sid=self.source('A cell is a biological unit. A cell contains cytoplasm.')
        class Web:
            def __init__(self):self.queries=[]
            def research(self,query,url=None):self.queries.append(query);return {'sources':[{'source_id':sid}]}
        web=Web();loop=WebIntentLoop(self.e,web);job=loop.start(['inspect cell'],100,max_searches=1)
        loop.step(job['id']);job=loop.step(job['id']);self.assertEqual(job['status'],'complete');self.assertEqual(web.queries,['cell'])
        self.assertEqual(len(job['results'][0]['result']['relations']),2)
        self.assertEqual(self.e.db.execute('SELECT COUNT(*) FROM word_relations').fetchone()[0],0)
    def test_duplicate_idempotence(self):
        sid=self.source('A cell contains cytoplasm.')
        self.e.extraction.extract(sid,'cell');self.e.extraction.extract(sid,'cell')
        self.assertEqual(len(self.e.extraction.inspect('cell')['relations']),1)
