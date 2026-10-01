import json
import unittest
from engine import Engine
from knowledge import parse_source
from web_intent_loop import WebIntentLoop
class FakeWeb:
    def __init__(self,sid):self.sid=sid;self.calls=[]
    def research(self,query,url=None):self.calls.append(query);return {'sources':[{'source_id':self.sid,'url':'https://example.org/relationships.json'}]}
class LoopTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:')
    def tearDown(self):self.e.close()
    def source(self,bad=False,prose=False):
        if prose:data='Ordinary prose about increase';mime='text/plain'
        else:
            data=json.dumps({'word_relationships':[{'text':'increase','intent':{'operation':'add','amount':2},'observations':[{'before':3,'after':5},{'before':7,'after':9},{'before':11,'after':14 if bad else 13}]}]});mime='application/json'
        sid=self.e.knowledge.ingest(parse_source(data,mime,'https://example.org/source'));self.e.encode_source(sid);return sid
    def test_search_ground_execute_next(self):
        web=FakeWeb(self.source());loop=WebIntentLoop(self.e,web);job=loop.start(['increase','increase'],100)
        loop.step(job['id']);job=loop.step(job['id']);self.assertEqual(job['index'],1)
        job=loop.step(job['id']);self.assertEqual(job['status'],'complete');self.assertEqual(job['results'][0]['result']['decoded'],102);self.assertEqual(len(web.calls),1)
    def test_prose_stops_and_resume(self):
        web=FakeWeb(self.source(prose=True));loop=WebIntentLoop(self.e,web);job=loop.start(['increase'],100,max_searches=1)
        loop.step(job['id']);job=loop.step(job['id']);self.assertEqual(job['status'],'needs_grounding');self.assertEqual(job['results'],[])
        self.assertEqual(loop.resume(job['id'])['status'],'running');self.assertEqual(loop.stop(job['id'])['status'],'stopped')
    def test_bad_import_atomic(self):
        loop=WebIntentLoop(self.e,FakeWeb(0))
        with self.assertRaises(ValueError):loop.import_source(self.source(bad=True))
        self.assertEqual(self.e.words.resolve('increase',100)['status'],'unknown')
        self.assertEqual(self.e.db.execute('SELECT COUNT(*) FROM web_word_provenance').fetchone()[0],0)
    def test_alphabetical_and_block(self):
        loop=WebIntentLoop(self.e,FakeWeb(self.source(prose=True)));job=loop.start(['z','a','m'],100,alphabetical=True)
        self.assertEqual(job['tasks'],['a','m','z'])
        self.e.words.register('a',intent={'operation':'add','amount':1});self.e.words.register('a',intent={'operation':'add','amount':2})
        self.assertEqual(loop.step(job['id'])['status'],'blocked')
    def test_network_error_bounded(self):
        class Failed:
            def research(self,*a):raise OSError('offline')
        loop=WebIntentLoop(self.e,Failed());job=loop.start(['unknown'],100,max_searches=1);job=loop.step(job['id'])
        self.assertEqual(job['history'][0]['status'],'web_error');self.assertEqual(loop.step(job['id'])['status'],'needs_grounding')
