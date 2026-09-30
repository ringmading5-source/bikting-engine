"""Public source lookup and page scraping feeding binary knowledge memory."""
from datetime import datetime,timezone
import ipaddress
import json
import re
import socket
from urllib.parse import urlencode,urlsplit
from knowledge import WebScraper,parse_source

class PublicScraper(WebScraper):
    def validate_url(self,url):
        p=super().validate_url(url)
        if p.port not in (None,80,443):raise ValueError('Only standard public web ports are supported')
        addresses=socket.getaddrinfo(p.hostname,p.port or (443 if p.scheme=='https' else 80),type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
            raise ValueError('Only public web destinations are permitted')
        return p

class WebKnowledge:
    def __init__(self,engine,scraper=None):
        self.engine=engine
        if scraper is None:
            from soup_scraper import SoupScraper
            scraper=SoupScraper(timeout=12,max_bytes=500_000)
        self.scraper=scraper
        self.engine.db.execute('CREATE TABLE IF NOT EXISTS web_queries (query TEXT PRIMARY KEY,sources TEXT NOT NULL,fetched_at TEXT NOT NULL)')
    def store(self,record):
        sid=self.engine.knowledge.ingest(record);self.engine.encode_source(sid);return sid
    def record(self,sid,query):
        state=self.engine.source_state(sid)
        row=self.engine.db.execute('SELECT * FROM sources WHERE id=?',(sid,)).fetchone()
        text=state.get(1).payload.decode('utf-8')
        terms=set(re.findall(r'\w+',query.casefold()))
        paragraphs=[s.strip() for s in text.splitlines() if s.strip()]
        excerpt=next((p for p in paragraphs if terms & set(re.findall(r'\w+',p.casefold()))),text)
        return {'source_id':sid,'title':row['title'],'url':row['source'],'excerpt':excerpt[:1200],
                'sha256':row['sha256'],'retrieved_at':row['retrieved_at'],'content_bytes':len(state.get(1).payload),
                'byte_preview':state.get(1).payload[:64].hex(' '),'status':'retrieved_source','verified_fact':False}
    def research(self,query,url=None):
        if not isinstance(query,str) or not query.strip() or len(query)>200:raise ValueError('Enter a topic of 1..200 characters')
        query=' '.join(query.split())
        if url:
            if not isinstance(url,str) or len(url)>2000:raise ValueError('invalid source URL')
            record=self.scraper.scrape(url);sid=self.store(record)
            ids=[sid]+[self.store(item) for item in record.get('embedded_relationships',[])[:5]]
            return {'status':'source_found','provider':'page_scraper','query':query,'cached':False,
                    'sources':[self.record(item,query) for item in ids],
                    'relationship_links':record.get('relationship_links',[]),
                    'scraper':'beautifulsoup4','scope':'source evidence; executable imports require validation'}
        key=query.casefold();row=self.engine.db.execute('SELECT * FROM web_queries WHERE query=?',(key,)).fetchone()
        if row and (datetime.now(timezone.utc)-datetime.fromisoformat(row['fetched_at'])).total_seconds()<3600:
            return {'status':'source_found','provider':'wikipedia_api','query':query,'cached':True,
                    'sources':[self.record(sid,query) for sid in json.loads(row['sources'])],
                    'scope':'source evidence; no executable relationship learned'}
        params={'action':'query','generator':'search','gsrsearch':query,'gsrnamespace':0,'gsrlimit':3,
                'prop':'extracts|info','exintro':1,'explaintext':1,'exchars':1200,'exlimit':3,
                'inprop':'url','format':'json','formatversion':2,'maxlag':5}
        data,mime,encoding=self.scraper.fetch('https://en.wikipedia.org/w/api.php?'+urlencode(params))
        if mime!='application/json':raise ValueError('Source API did not return JSON')
        payload=json.loads(data.decode(encoding))
        if 'error' in payload:raise ValueError('Source API error: '+str(payload['error'].get('code','unknown')))
        pages=payload.get('query',{}).get('pages',[])
        if not isinstance(pages,list):raise ValueError('Unexpected source API response')
        ids=[]
        for page in sorted(pages,key=lambda p:p.get('index',999))[:3]:
            text=page.get('extract','');source=page.get('fullurl','');p=urlsplit(source)
            if not isinstance(text,str) or not text.strip():continue
            if p.scheme!='https' or p.hostname!='en.wikipedia.org' or p.username or p.password:continue
            record=parse_source(text,'text/plain',source);record['title']=str(page.get('title',query))
            ids.append(self.store(record))
        if not ids:return {'status':'unknown','provider':'wikipedia_api','query':query,'sources':[],'reason':'No source extracts returned.'}
        with self.engine.db:self.engine.db.execute('INSERT OR REPLACE INTO web_queries VALUES (?,?,?)',(key,json.dumps(ids),datetime.now(timezone.utc).isoformat()))
        return {'status':'source_found','provider':'wikipedia_api','query':query,'cached':False,
                'sources':[self.record(sid,query) for sid in ids],
                'scope':'source evidence; no executable relationship learned'}
