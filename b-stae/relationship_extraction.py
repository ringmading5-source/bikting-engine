"""Bounded English relation extraction with exact source spans and byte states."""
import hashlib
import json
import re
from core import BinaryState,Record,BLOB

class RelationshipExtraction:
    def __init__(self,engine):
        self.engine=engine;self.db=engine.db
        self.db.execute('''CREATE TABLE IF NOT EXISTS extracted_relations (
            fingerprint TEXT PRIMARY KEY, subject TEXT NOT NULL, predicate TEXT NOT NULL,
            source_id INTEGER NOT NULL, source_hash TEXT NOT NULL, descriptor BLOB NOT NULL,
            state BLOB NOT NULL, state_hash TEXT NOT NULL)''')
        self.db.execute('CREATE INDEX IF NOT EXISTS extracted_subjects ON extracted_relations(subject,predicate)')
    def subject(self,text):
        if not isinstance(text,str):raise ValueError('text subject required')
        text=' '.join(text.lower().split())
        if not re.fullmatch(r'[a-z][a-z -]{0,60}',text):raise ValueError('supported subject is bounded English words')
        return text
    def request(self,text):
        if not isinstance(text,str):return None
        match=re.fullmatch(r'\s*(inspect|describe)\s+([a-z][a-z -]{0,60})\s*',text,re.I)
        return self.subject(match[2]) if match else None
    def extract(self,sid,subject):
        subject=self.subject(subject)
        row=self.db.execute('SELECT * FROM sources WHERE id=?',(sid,)).fetchone()
        if row is None:raise ValueError('unknown source')
        text=self.engine.source_state(sid).get(1).payload.decode();found=[]
        patterns=[('is_a',r'is\s+(?:a|an)\s+([^.!?\n]{1,250})'),
            ('contains',r'contains\s+([^.!?\n]{1,250})'),
            ('has_count',r'has\s+([0-9]{1,9})\s+([a-z][a-z -]{0,100})'),
            ('converts',r'converts\s+([a-z][a-z -]{0,100}?)\s+into\s+([a-z][a-z -]{0,100})')]
        prefix=r'(?:^|[.!?]\s+|\n)(?:(?:a|an|the)\s+)?'+re.escape(subject)+r'\s+'
        for predicate,pattern in patterns:
            for match in re.finditer(prefix+pattern,text,re.I):
                if len(found)>=32:break
                clause=match.group().lstrip('.!? \n');start=match.end()-len(clause);end=match.end()
                if predicate=='has_count':object_value={'count':int(match[1]),'item':match[2].strip().lower()}
                elif predicate=='converts':object_value={'from':match[1].strip().lower(),'to':match[2].strip().lower()}
                else:object_value=match[1].strip()
                assertion='qualified' if re.search(r'\b(may|might|sometimes|usually|possibly|not|except)\b',clause,re.I) else 'source_asserted'
                descriptor={'subject':subject,'predicate':predicate,'object':object_value,'assertion':assertion,
                    'source_id':sid,'source_hash':row['sha256'],'evidence':{'start':start,'end':end,'clause':clause},
                    'scope':'extracted source claim, not independently established fact or executable behavior'}
                raw=json.dumps(descriptor,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
                fingerprint=hashlib.sha256(raw).hexdigest();state=BinaryState((Record(1,BLOB,raw),)).encode()
                with self.db:self.db.execute('INSERT OR IGNORE INTO extracted_relations VALUES (?,?,?,?,?,?,?,?)',
                    (fingerprint,subject,predicate,sid,row['sha256'],raw,state,hashlib.sha256(state).hexdigest()))
                found.append(descriptor)
        return {'status':'relations_extracted' if found else 'evidence_only','count':len(found),'relations':found}
    def inspect(self,subject):
        subject=self.subject(subject);relations=[];states=[]
        for row in self.db.execute('SELECT * FROM extracted_relations WHERE subject=? ORDER BY predicate,fingerprint LIMIT 65',(subject,)):
            source=self.db.execute('SELECT * FROM sources WHERE id=?',(row['source_id'],)).fetchone()
            if source is None or source['sha256']!=row['source_hash']:continue
            text=self.engine.source_state(row['source_id']).get(1).payload.decode()
            raw=bytes(row['descriptor']);state=bytes(row['state'])
            if hashlib.sha256(raw).hexdigest()!=row['fingerprint'] or hashlib.sha256(state).hexdigest()!=row['state_hash'] or BinaryState.decode(state).get(1).payload!=raw:raise ValueError('corrupt extracted relationship')
            descriptor=json.loads(raw);span=descriptor['evidence']
            if descriptor['source_hash']!=source['sha256'] or text[span['start']:span['end']]!=span['clause']:raise ValueError('relationship evidence mismatch')
            relations.append(dict(descriptor,url=source['source']));states.append(state.hex())
        if len(relations)>64:return {'status':'bounded','reason':'relationship display budget reached'}
        if not relations:return {'status':'unknown','reason':'No supported source relationships extracted.'}
        # Count disagreements are detectable without treating every differing
        # definition or list of contents as a contradiction.
        counts={}
        for relation in relations:
            if relation['predicate']=='has_count':counts.setdefault(relation['object']['item'],set()).add(relation['object']['count'])
        conflicts=[{'item':item,'counts':sorted(values)} for item,values in counts.items() if len(values)>1]
        return {'status':'fulfilled','operation':'inspect_source_relationships','subject':subject,'relations':relations,
            'conflicts':conflicts,'state_hex':states,'verified':True,
            'verification_scope':'byte integrity and exact source spans; factual truth is not verified'}
