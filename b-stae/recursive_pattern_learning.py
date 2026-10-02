"""Bounded bottom-up pair discovery, without supplied word/sentence boundaries.

This is symbolic frequency-based compression, not semantic learning. Raw
observations and every considered pair remain; selected pairs become new units.
"""
import json
from collections import Counter,defaultdict
from pattern_memory import encoded


class RecursivePatternLearning:
    def __init__(self,engine):
        self.db=engine.db
        self.db.executescript('''CREATE TABLE IF NOT EXISTS recursive_units
          (id INTEGER PRIMARY KEY, mode TEXT NOT NULL, kind TEXT NOT NULL,
           parts TEXT NOT NULL, depth INTEGER NOT NULL, UNIQUE(mode,kind,parts));
          CREATE TABLE IF NOT EXISTS recursive_runs
          (id INTEGER PRIMARY KEY, context TEXT NOT NULL, mode TEXT NOT NULL, model TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS recursive_context ON recursive_runs(context,id);
          CREATE TABLE IF NOT EXISTS recursive_observations
          (id INTEGER PRIMARY KEY, run INTEGER NOT NULL, source TEXT NOT NULL, units TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS recursive_candidates
          (run INTEGER NOT NULL, round INTEGER NOT NULL, pair TEXT NOT NULL,
           occurrences INTEGER NOT NULL, distinct_documents INTEGER NOT NULL, chosen INTEGER NOT NULL);''')

    def raw(self,text,mode):
        if mode not in ('character','byte'):raise ValueError('character or byte mode required')
        if not isinstance(text,str) or not text or len(text)>512:raise ValueError('1..512 Unicode characters required')
        try:
            binary=text.encode('utf-8')
            return list(binary) if mode=='byte' else [ord(c) for c in text]
        except UnicodeEncodeError:raise ValueError('valid Unicode required') from None

    def node(self,mode,kind,parts,depth):
        self.db.execute('INSERT OR IGNORE INTO recursive_units(mode,kind,parts,depth) VALUES (?,?,?,?)',
                        (mode,kind,encoded(parts),depth))
        return self.db.execute('SELECT id FROM recursive_units WHERE mode=? AND kind=? AND parts=?',
                               (mode,kind,encoded(parts))).fetchone()[0]

    def replace(self,sequence,pair,unit):
        result=[];i=0
        while i<len(sequence):
            if i+1<len(sequence) and sequence[i:i+2]==pair:result.append(unit);i+=2
            else:result.append(sequence[i]);i+=1
        return result

    def learn(self,examples,context=None,mode='character',rounds=24,max_depth=8,min_documents=2,include_history=True):
        if not isinstance(examples,list) or not 2<=len(examples)<=128:raise ValueError('2..128 raw observations required')
        for value,low,high in ((rounds,1,64),(max_depth,1,16),(min_documents,2,128)):
            if type(value) is not int or not low<=value<=high:raise ValueError('invalid discovery bounds')
        raws=[]
        for e in examples:
            if not isinstance(e,dict) or set(e)!={'text','source'} or not isinstance(e['source'],str) or not 1<=len(e['source'])<=256:
                raise ValueError('raw text and source required')
            raws.append(self.raw(e['text'],mode))
        if type(include_history) is not bool:raise ValueError('include_history must be boolean')
        new_raws=list(raws);observation_ids=[]
        if include_history:
            previous=list(self.db.execute('''SELECT o.* FROM recursive_observations o
                JOIN recursive_runs r ON r.id=o.run WHERE r.context=? AND r.mode=? ORDER BY o.id LIMIT 129''',
                                          (encoded(context),mode)))
            observation_ids=[r['id'] for r in previous]
            raws=[json.loads(r['units']) for r in previous]+raws
        if len(raws)>128 or sum(map(len,raws))>16384:raise ValueError('history plus batch exceeds 128 observations or 16384 base units')
        rules=[];history=[];depths={}
        with self.db:
            run=self.db.execute('INSERT INTO recursive_runs(context,mode,model) VALUES (?,?,?)',(encoded(context),mode,'{}')).lastrowid
            sequences=[]
            for e,raw in zip(examples,new_raws):
                observation_ids.append(self.db.execute('INSERT INTO recursive_observations(run,source,units) VALUES (?,?,?)',(run,e['source'],encoded(raw))).lastrowid)
            for raw in raws:
                sequence=[self.node(mode,'atom',[v],0) for v in raw];sequences.append(sequence)
                depths.update({v:0 for v in sequence})
            original=sum(map(len,sequences));stopped='no_supported_pair'
            for step in range(rounds):
                counts=Counter();documents=defaultdict(set)
                for raw,sequence in zip(raws,sequences):
                    for a,b in zip(sequence,sequence[1:]):
                        pair=(a,b);counts[pair]+=1;documents[pair].add(encoded(raw))
                eligible=[p for p in counts if len(documents[p])>=min_documents and max(depths[v] for v in p)<max_depth]
                chosen=min(eligible,key=lambda p:(-counts[p],p)) if eligible else None
                self.db.executemany('INSERT INTO recursive_candidates VALUES (?,?,?,?,?,?)',
                                    [(run,step,encoded(list(p)),count,len(documents[p]),int(p==chosen)) for p,count in counts.items()])
                if chosen is None:break
                depth=1+max(depths[v] for v in chosen);unit=self.node(mode,'pair',list(chosen),depth);depths[unit]=depth
                sequences=[self.replace(s,list(chosen),unit) for s in sequences]
                rules.append({'pair':list(chosen),'unit':unit,'depth':depth,'occurrences':counts[chosen],
                              'distinct_documents':len(documents[chosen])})
                history.append({'round':step+1,'stored_patterns':len(rules),'working_units':sum(map(len,sequences))})
            else:stopped='round_budget'
            model={'rules':rules,'mode':mode,'max_depth':max_depth,'stop_reason':stopped,'observations':len(raws),'observation_ids':observation_ids}
            self.db.execute('UPDATE recursive_runs SET model=? WHERE id=?',(encoded(model),run))
        return {'run_id':run,'mode':mode,'training_observations':len(raws),'new_observations':len(examples),'patterns_discovered':len(rules),'maximum_depth':max([r['depth'] for r in rules],default=0),
                'original_units':original,'compressed_units':sum(map(len,sequences)),'history':history,
                'stop_reason':stopped,'evidence_retained':True,'scope':'Recursive frequent-pair discovery; no word boundaries or semantic labels supplied.'}

    def select(self,context,mode):
        if mode not in ('character','byte'):raise ValueError('character or byte mode required')
        row=self.db.execute('SELECT * FROM recursive_runs WHERE context=? AND mode=? ORDER BY id DESC LIMIT 1',(encoded(context),mode)).fetchone()
        return row

    def encode(self,text,context=None,mode='character',run_id=None):
        raw=self.raw(text,mode)
        if run_id is None:row=self.select(context,mode)
        else:
            if type(run_id) is not int or run_id<1:raise ValueError('positive hierarchy version required')
            row=self.db.execute('SELECT * FROM recursive_runs WHERE id=? AND context=? AND mode=?',(run_id,encoded(context),mode)).fetchone()
        if row is None:return {'status':'unknown','units':[],'reason':'No learned hierarchy for this context/mode.'}
        sequence=[]
        for value in raw:
            atom=self.db.execute('SELECT id FROM recursive_units WHERE mode=? AND kind=? AND parts=?',(mode,'atom',encoded([value]))).fetchone()
            sequence.append(atom[0] if atom else {'literal':value})
        model=json.loads(row['model'])
        for rule in model['rules']:sequence=self.replace(sequence,rule['pair'],rule['unit'])
        packet={'status':'encoded','run_id':row['id'],'mode':mode,'units':sequence,'base_units':len(raw),'compressed_units':len(sequence)}
        if self.decode(sequence,mode)!=text:raise ValueError('round-trip verification failed')
        packet['roundtrip_verified']=True
        return packet

    def expand(self,unit,mode,cache=None):
        cache={} if cache is None else cache
        if isinstance(unit,dict):
            if set(unit)!={'literal'} or type(unit['literal']) is not int:raise ValueError('invalid literal unit')
            return [unit['literal']]
        if type(unit) is not int or unit<1:raise ValueError('positive unit ID required')
        if unit in cache:return cache[unit]
        row=self.db.execute('SELECT * FROM recursive_units WHERE id=? AND mode=?',(unit,mode)).fetchone()
        if row is None:raise ValueError('unknown unit or wrong mode')
        parts=json.loads(row['parts'])
        if row['kind']=='atom':result=parts
        else:
            if len(parts)!=2 or any(type(v) is not int or v>=unit or v<1 for v in parts):raise ValueError('invalid hierarchy links')
            result=self.expand(parts[0],mode,cache)+self.expand(parts[1],mode,cache)
        cache[unit]=result;return result

    def decode(self,units,mode='character'):
        if mode not in ('character','byte') or not isinstance(units,list) or not 1<=len(units)<=2048:raise ValueError('bounded units and valid mode required')
        raw=[];cache={}
        for unit in units:
            raw.extend(self.expand(unit,mode,cache))
            if len(raw)>2048:raise ValueError('expanded unit budget exceeded')
        try:text=bytes(raw).decode('utf-8') if mode=='byte' else ''.join(chr(v) for v in raw)
        except (ValueError,UnicodeDecodeError,OverflowError):raise ValueError('invalid base sequence') from None
        try:text.encode('utf-8')
        except UnicodeEncodeError:raise ValueError('invalid Unicode base sequence') from None
        if len(text)>512:raise ValueError('decoded character budget exceeded')
        return text

    def inventory(self,context=None,mode='character'):
        row=self.select(context,mode)
        if row is None:return {'status':'unknown','patterns':[]}
        model=json.loads(row['model']);patterns=[]
        for rule in model['rules']:
            raw=self.expand(rule['unit'],mode)
            # Byte fragments can split a Unicode character; retain numeric units.
            try:display=bytes(raw).decode('utf-8') if mode=='byte' else ''.join(chr(v) for v in raw)
            except UnicodeDecodeError:display=None
            patterns.append({**rule,'base_numbers':raw,'readable':display})
        return {'status':'learned','run_id':row['id'],'mode':mode,'patterns':patterns,'stop_reason':model['stop_reason']}
