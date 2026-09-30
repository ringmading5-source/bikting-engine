import json
import unittest
from unittest.mock import patch
from engine import Engine
from knowledge import WebScraper
from web_knowledge import WebKnowledge,PublicScraper
from app import Application

class Fake(WebScraper):
    def __init__(self):super().__init__();self.calls=[]
    def fetch(self,url):
        self.calls.append(url)
        if 'w/api.php?' in url:
            body={'query':{'pages':[{'title':'Ball','index':1,'fullurl':'https://en.wikipedia.org/wiki/Ball','extract':'A ball is a round object used in games.'}]}}
            return json.dumps(body).encode(),'application/json','utf-8'
        if url.endswith('robots.txt'):return b'User-agent: *\nAllow: /','text/plain','utf-8'
        return b'<title>Ball</title><p>A ball is a round object.</p><script>bad()</script>','text/html','utf-8'

class WebTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:');self.f=Fake();self.web=WebKnowledge(self.e,self.f)
    def tearDown(self):self.e.close()
    def test_lookup_stores_binary_evidence_and_caches(self):
        result=self.web.research('ball')
        self.assertEqual(result['status'],'source_found')
        sid=result['sources'][0]['source_id']
        self.assertIn(b'round object',self.e.source_state(sid).get(1).payload)
        self.assertFalse(result['sources'][0]['verified_fact'])
        self.assertFalse(self.e.relationships.load())
        self.assertTrue(self.web.research('Ball')['cached']);self.assertEqual(len(self.f.calls),1)
    def test_page_scraping(self):
        result=self.web.research('ball','https://example.org/ball')
        self.assertEqual(result['provider'],'page_scraper')
        self.assertNotIn('bad()',result['sources'][0]['excerpt'])
    def test_private_destinations_rejected(self):
        with patch('socket.getaddrinfo',return_value=[(2,1,6,'',('127.0.0.1',443))]):
            with self.assertRaises(ValueError):PublicScraper().validate_url('https://localhost/page')
        with self.assertRaises(ValueError):PublicScraper().validate_url('file:///etc/passwd')
    def test_network_failure_explicit(self):
        app=Application(self.e)
        with patch.object(app.web,'research',side_effect=TimeoutError('source timed out')):
            self.assertEqual(app.dispatch({'action':'research','query':'ball'})['status'],'web_error')
    def test_query_bounds(self):
        with self.assertRaises(ValueError):self.web.research('')
        with self.assertRaises(ValueError):self.web.research('x'*201)

if __name__=='__main__':unittest.main()
