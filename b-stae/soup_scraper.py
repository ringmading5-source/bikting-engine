"""Beautiful Soup extraction on the existing bounded public HTTP adapter."""
import json
from urllib.parse import urljoin,urlsplit
from bs4 import BeautifulSoup
from knowledge import parse_source
from web_knowledge import PublicScraper

class SoupScraper(PublicScraper):
    def parse_page(self,content,mime,url):
        if mime!='text/html':return parse_source(content,mime,url)
        soup=BeautifulSoup(content,'html.parser')
        title=soup.title.get_text(' ',strip=True) if soup.title else url
        embedded=[]
        for node in soup.find_all('script',attrs={'type':'application/json'},limit=20):
            try:
                data=json.loads(node.string or node.get_text())
                if isinstance(data,dict) and set(data)=={'word_relationships'}:
                    embedded.append(parse_source(json.dumps(data),'application/json',url+'#bstae-'+str(len(embedded))))
            except (ValueError,TypeError):continue
        links=[]
        for node in soup.find_all('a',href=True,limit=200):
            link=urljoin(url,node['href']);p=urlsplit(link)
            if p.scheme in ('http','https') and p.netloc==urlsplit(url).netloc and p.path.endswith('.json') and not p.username and not p.password:
                if link not in links:links.append(link)
            if len(links)>=5:break
        for node in soup(['script','style','noscript','template','nav','footer']):node.decompose()
        body=soup.find('main') or soup.find('article') or soup.body or soup
        text=body.get_text('\n',strip=True)
        if not text and embedded:text='Structured B-STAE relationship source'
        record=parse_source(text,'text/plain',url);record['title']=title
        record['embedded_relationships']=embedded;record['relationship_links']=links
        return record
