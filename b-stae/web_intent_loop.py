"""Persistent bounded discovery queue; web evidence is distinct from execution."""
import json
import secrets
from web_knowledge import WebKnowledge

class WebIntentLoop:
    def __init__(self,engine,web=None):
        self.engine=engine;self.db=engine.db;self.web=web or WebKnowledge(engine)
        self.db.execute('''CREATE TABLE IF NOT EXISTS intent_search_jobs (
            id TEXT PRIMARY KEY, data TEXT NOT NULL)''')
        self.db.execute('''CREATE TABLE IF NOT EXISTS web_word_provenance (
            source_id INTEGER PRIMARY KEY, source_hash TEXT NOT NULL, definitions TEXT NOT NULL)''')
    def import_source(self,sid):
        row=self.db.execute('SELECT * FROM sources WHERE id=?',(sid,)).fetchone()
        if row is None or row['mime']!='application/json':return {'status':'evidence_only'}
        data=json.loads(self.engine.source_state(sid).get(1).payload.decode())
        if not isinstance(data,dict) or set(data)!={'word_relationships'}:return {'status':'evidence_only'}
        entries=data['word_relationships']
        if not isinstance(entries,list) or not 1<=len(entries)<=20:raise ValueError('bounded word_relationships required')
        # A savepoint keeps all definitions and stable reports atomic on failure.
        self.db.execute('SAVEPOINT web_words')
        try:
            for item in entries:
                if not isinstance(item,dict) or set(item) not in ({'text','intent','training','validation'},{'text','children','training','validation'}):raise ValueError('relationship definition and train/validation evidence required')
                self.engine.words.register(item['text'],children=item.get('children'),intent=item.get('intent'),commit=False)
            for item in entries:
                inputs={};context=None
                for split,minimum in [('training',2),('validation',1)]:
                    examples=item[split]
                    if not isinstance(examples,list) or not minimum<=len(examples)<=10:raise ValueError('two training and one held-out example required')
                    inputs[split]=set()
                    for example in examples:
                        if not isinstance(example,dict) or set(example)!={'before','after'}:raise ValueError('before/after required')
                        a,ca=self.engine.modalities.recognize(example['before']);b,cb=self.engine.modalities.recognize(example['after'])
                        if context is None:context=ca
                        if ca!=context or cb!=context:raise ValueError('observation context differs')
                        inputs[split].add(a.state.encode())
                        result=self.engine.words.resolve(item['text'],example['before'],persist=False)
                        if result['status']!='stabilized' or result['coherence']['target_hex']!=b.state.encode().hex():raise ValueError('web relationship fails grounded observation')
                if len(inputs['training'])<2 or inputs['training']&inputs['validation']:raise ValueError('held-out observations required')
            self.db.execute('INSERT OR REPLACE INTO web_word_provenance VALUES (?,?,?)',(sid,row['sha256'],json.dumps(entries)))
            self.db.execute('RELEASE web_words')
            return {'status':'registered','relationships':len(entries),'source_id':sid}
        except Exception:
            self.db.execute('ROLLBACK TO web_words');self.db.execute('RELEASE web_words');raise
    def start(self,texts,value,urls=None,max_searches=3,alphabetical=False):
        if not isinstance(texts,list) or not 1<=len(texts)<=64 or any(not isinstance(t,str) or not t.strip() or len(t)>200 for t in texts):raise ValueError('1..64 text tasks of at most 200 characters required')
        if type(max_searches)is not int or not 1<=max_searches<=5:raise ValueError('search bound must be 1..5 per task')
        self.engine.modalities.recognize(value)
        if urls is None:urls=[]
        if not isinstance(urls,list) or len(urls)>5 or any(not isinstance(u,str) or len(u)>2000 for u in urls):raise ValueError('up to five source URLs required')
        if alphabetical:texts=sorted(texts,key=str.casefold)
        data={'id':secrets.token_hex(12),'status':'running','index':0,'tasks':texts,'value':value,'urls':urls,
            'max_searches':max_searches,'attempt':0,'results':[],'history':[],'seen_sources':[],'discovered_urls':[]}
        self.save(data);return data
    def save(self,data):
        with self.db:self.db.execute('INSERT OR REPLACE INTO intent_search_jobs VALUES (?,?)',(data['id'],json.dumps(data)))
    def get(self,jid):
        row=self.db.execute('SELECT data FROM intent_search_jobs WHERE id=?',(jid,)).fetchone()
        if row is None:raise ValueError('unknown search job')
        return json.loads(row[0])
    def step(self,jid):
        data=self.get(jid)
        if data['status']!='running':return data
        text=data['tasks'][data['index']]
        result=self.engine.words.resolve(text,data['value'])
        if result['status']=='stabilized':
            executed=self.engine.words.execute(text,data['value']);data['results'].append({'text':text,'result':executed})
            data['index']+=1;data['attempt']=0;data['seen_sources']=[]
            if data['index']==len(data['tasks']):data['status']='complete'
            self.save(data);return data
        if result['status']=='unknown':
            inspection_subject=self.engine.extraction.request(text)
            concept=self.engine.extraction.inspect(inspection_subject) if inspection_subject else self.engine.concepts.resolve(text)
            if concept['status']=='fulfilled':
                data['results'].append({'text':text,'result':concept});data['index']+=1;data['attempt']=0;data['seen_sources']=[]
                if data['index']==len(data['tasks']):data['status']='complete'
                self.save(data);return data
            if concept['status']=='ambiguous':result=concept
        if result['status']!='unknown':
            data['status']='blocked';data['reason']=result.get('reason',result['status']);self.save(data);return data
        if data['attempt']>=data['max_searches']:
            data['status']='needs_grounding';data['reason']='Search budget exhausted; evidence has not resolved the intent.';self.save(data);return data
        attempt=data['attempt'];data['attempt']+=1
        unresolved=[]
        if result.get('trace'):
            for item in result['trace'][-1]['after']:
                if 'words' in item:unresolved.append(' '.join(bytes.fromhex(w).decode() for w in item['words']))
        concept_request=self.engine.concepts.request(text)
        inspection_subject=self.engine.extraction.request(text)
        queries=([inspection_subject] if inspection_subject else ([concept_request['subject']] if concept_request else []))+[text]+unresolved+[word.decode() for word in self.engine.words.tokens(text)]
        queries=list(dict.fromkeys(queries));query=queries[min(attempt,len(queries)-1)]
        try:
            url=data['urls'][attempt] if attempt<len(data['urls']) else (data.get('discovered_urls',[]).pop(0) if data.get('discovered_urls') else None)
            found=self.web.research(query,url)
            for link in found.get('relationship_links',[])[:5]:
                if link not in data['urls'] and link not in data.setdefault('discovered_urls',[]):data['discovered_urls'].append(link)
            data['discovered_urls']=data['discovered_urls'][:5]
            history={'task':text,'query':query,'sources':found.get('sources',[]),'imports':[]}
            for source in found.get('sources',[]):
                sid=source['source_id']
                if sid in data['seen_sources']:continue
                data['seen_sources'].append(sid)
                try:
                    history['imports'].append(self.import_source(sid))
                    if concept_request:
                        history['imports'].append(self.engine.concepts.extract(sid,concept_request['subject']))
                        history['imports'].append(self.engine.extraction.extract(sid,concept_request['subject']))
                    if inspection_subject:history['imports'].append(self.engine.extraction.extract(sid,inspection_subject))
                except (ValueError,TypeError,KeyError) as error:history['imports'].append({'status':'rejected','reason':str(error)})
            data['history'].append(history)
        except Exception as error:
            data['history'].append({'task':text,'query':query,'status':'web_error','reason':str(error)})
        self.save(data);return data
    def resume(self,jid):
        data=self.get(jid)
        if data['status'] in ('needs_grounding','blocked'):
            data['status']='running';data['attempt']=0;data['seen_sources']=[];self.save(data)
        return data
    def stop(self,jid):
        data=self.get(jid);data['status']='stopped';self.save(data);return data
