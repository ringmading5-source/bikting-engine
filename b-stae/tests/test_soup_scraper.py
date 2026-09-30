import json
import unittest
from engine import Engine
from soup_scraper import SoupScraper
from web_knowledge import WebKnowledge
from web_intent_loop import WebIntentLoop

class SoupTests(unittest.TestCase):
    def test_extract_and_links(self):
        scraper=SoupScraper()
        record=scraper.parse_page('<title>Example</title><nav>noise</nav><main><h1>Useful</h1><p>Body</p><script>bad()</script><a href="rules.json">Rules</a><a href="https://other.org/no.json">Other</a></main>','text/html','https://example.org/page')
        self.assertEqual(record['title'],'Example');self.assertIn('Body',record['text']);self.assertNotIn('bad()',record['text']);self.assertNotIn('noise',record['text'])
        self.assertEqual(record['relationship_links'],['https://example.org/rules.json'])
    def test_scrape_to_grounded_loop(self):
        data={'word_relationships':[{'text':'increase','intent':{'operation':'add','amount':2},'training':[{'before':3,'after':5},{'before':7,'after':9}],'validation':[{'before':11,'after':13}]}]}
        html='<main>Observed behavior</main><script type="application/json">'+json.dumps(data)+'</script>'
        class Fixture(SoupScraper):
            def scrape(self,url):return self.parse_page(html,'text/html',url)
        e=Engine(database=':memory:')
        try:
            web=WebKnowledge(e,Fixture());loop=WebIntentLoop(e,web);job=loop.start(['increase'],100,urls=['https://example.org/page'])
            job=loop.step(job['id']);self.assertEqual(len(job['history'][0]['sources']),2)
            job=loop.step(job['id']);self.assertEqual(job['status'],'complete');self.assertEqual(job['results'][0]['result']['decoded'],102)
        finally:e.close()
    def test_bad_json_is_not_executed(self):
        record=SoupScraper().parse_page('<main>Text</main><script type="application/json">broken</script>','text/html','https://example.org')
        self.assertEqual(record['embedded_relationships'],[])
