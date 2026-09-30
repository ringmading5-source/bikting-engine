"""Source-backed knowledge ingestion and deterministic retrieval; no model calls."""
import argparse
import hashlib
import gzip
import io
import json
import re
import sqlite3
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.robotparser import RobotFileParser

USER_AGENT = 'B-STAE/0.2'
MAX_BYTES = 2_000_000

class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.hidden = 0
        self.title_depth = 0
        self.parts, self.title_parts = [], []
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'noscript'): self.hidden += 1
        if tag == 'title': self.title_depth += 1
        if tag in ('p', 'div', 'li', 'br', 'h1', 'h2', 'h3', 'tr'): self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'noscript'): self.hidden = max(0, self.hidden - 1)
        if tag == 'title': self.title_depth = max(0, self.title_depth - 1)
        if tag in ('p', 'div', 'li', 'h1', 'h2', 'h3', 'tr'): self.parts.append('\n')
    def handle_data(self, data):
        if not self.hidden:
            if self.title_depth: self.title_parts.append(data)
            else: self.parts.append(data)
    def extract(self):
        return (' '.join(''.join(self.title_parts).split()),
                '\n'.join(' '.join(line.split()) for line in ''.join(self.parts).splitlines() if line.strip()))

class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('redirect refused; supply the final URL explicitly')

class WebScraper:
    """One explicit public page per call; robots checked, no JS or recursive crawl."""
    def __init__(self, timeout=15, max_bytes=MAX_BYTES):
        self.timeout, self.max_bytes = timeout, max_bytes
        self.opener = build_opener(NoRedirects())
    def validate_url(self, url):
        p = urlsplit(url)
        if p.scheme not in ('https', 'http') or not p.hostname or p.username or p.password:
            raise ValueError('absolute HTTP(S) URL without credentials required')
        return p
    def fetch(self, url):
        self.validate_url(url)
        with self.opener.open(Request(url, headers={'User-Agent': USER_AGENT, 'Accept-Encoding': 'identity'}), timeout=self.timeout) as r:
            data = r.read(self.max_bytes + 1)
            if len(data) > self.max_bytes: raise ValueError('source exceeds byte limit')
            encoding = r.headers.get('Content-Encoding', 'identity')
            if encoding == 'gzip':
                with gzip.GzipFile(fileobj=io.BytesIO(data)) as compressed:
                    data = compressed.read(self.max_bytes + 1)
                if len(data) > self.max_bytes: raise ValueError('decoded source exceeds byte limit')
            elif encoding != 'identity':
                raise ValueError('unsupported content encoding: ' + encoding)
            return data, r.headers.get_content_type(), r.headers.get_content_charset() or 'utf-8'
    def scrape(self, url):
        p = self.validate_url(url)
        robots_url = f'{p.scheme}://{p.netloc}/robots.txt'
        data, _, encoding = self.fetch(robots_url)
        robots = RobotFileParser()
        robots.parse(data.decode(encoding, errors='replace').splitlines())
        if not robots.can_fetch(USER_AGENT, url): raise ValueError('robots.txt disallows retrieval')
        # Fail closed if robots cannot be fetched; no bypass option.
        data, mime, encoding = self.fetch(url)
        if mime not in ('text/html', 'text/plain', 'application/json'):
            raise ValueError('supported sources: HTML, plain text, JSON')
        return parse_source(data.decode(encoding, errors='replace'), mime, url)

def parse_source(content, mime, source):
    title = source
    if mime == 'text/html':
        parser = PageParser(); parser.feed(content)
        title, content = parser.extract()
        title = title or source
    elif mime == 'application/json':
        content = json.dumps(json.loads(content), ensure_ascii=False, sort_keys=True, indent=2)
    if not content.strip(): raise ValueError('no extractable content')
    return {'source': source, 'title': title, 'text': content, 'mime': mime,
            'sha256': hashlib.sha256(content.encode()).hexdigest(),
            'retrieved_at': datetime.now(timezone.utc).isoformat()}

class KnowledgeMemory:
    def __init__(self, path='knowledge.sqlite3'):
        self.db = sqlite3.connect(path)
        self.db.row_factory = sqlite3.Row
        self.db.execute('CREATE TABLE IF NOT EXISTS sources (id INTEGER PRIMARY KEY, source TEXT, title TEXT, text TEXT, mime TEXT, sha256 TEXT, retrieved_at TEXT, UNIQUE(source, sha256))')
    def close(self): self.db.close()
    def ingest(self, record):
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO sources(source,title,text,mime,sha256,retrieved_at) VALUES (:source,:title,:text,:mime,:sha256,:retrieved_at)', record)
        return self.db.execute('SELECT id FROM sources WHERE source=? AND sha256=?', (record['source'], record['sha256'])).fetchone()[0]
    def ingest_file(self, path):
        path = Path(path).resolve()
        if path.stat().st_size > MAX_BYTES: raise ValueError('source exceeds byte limit')
        mime = {'.html': 'text/html', '.htm': 'text/html', '.json': 'application/json', '.txt': 'text/plain', '.md': 'text/plain', '.csv': 'text/plain'}.get(path.suffix.lower())
        if mime is None: raise ValueError('unsupported file type')
        return self.ingest(parse_source(path.read_text(encoding='utf-8'), mime, path.as_uri()))
    def ingest_web(self, url, scraper=None):
        return self.ingest((scraper or WebScraper()).scrape(url))
    def search(self, query, limit=5):
        """Casefolded Unicode token coverage, deterministic tie breaking; not semantics."""
        terms = set(re.findall(r'\w+', query.casefold()))
        if not terms or limit < 1: return []
        hits = []
        for row in self.db.execute('SELECT * FROM sources ORDER BY id'):
            record = dict(row)
            tokens = set(re.findall(r'\w+', (record['title'] + '\n' + record['text']).casefold()))
            matched = terms & tokens
            if matched:
                lines = record['text'].splitlines()
                excerpt = next((line for line in lines if matched & set(re.findall(r'\w+', line.casefold()))), record['text'])
                record.update(score=len(matched)/len(terms), excerpt=excerpt[:500], verified=False)
                hits.append(record)
        return sorted(hits, key=lambda r: (-r['score'], r['id']))[:limit]

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', default='knowledge.sqlite3')
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('web').add_argument('url')
    sub.add_parser('file').add_argument('path')
    sub.add_parser('search').add_argument('query')
    args = parser.parse_args()
    memory = KnowledgeMemory(args.db)
    try:
        if args.command == 'web': result = {'source_id': memory.ingest_web(args.url)}
        elif args.command == 'file': result = {'source_id': memory.ingest_file(args.path)}
        else: result = memory.search(args.query)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    finally: memory.close()
