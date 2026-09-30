"""Automatic, format-conditioned byte program memory for supported ordinary inputs."""
import base64
import hashlib
import json
from recognition import Recognized
from core import decode_outputs
from learning import infer_rule
from byte_relationships import Relationship
from output import render

class ModalityMemory:
    def __init__(self,engine):
        self.engine=engine;self.db=engine.db
        self.db.execute('''CREATE TABLE IF NOT EXISTS modality_programs (
            fingerprint TEXT PRIMARY KEY, program BLOB NOT NULL, program_hash TEXT NOT NULL,
            context TEXT NOT NULL, observations TEXT NOT NULL, report TEXT NOT NULL)''')
    def recognize(self,value):
        recognized=self.engine.recognize(value)
        if recognized.representation not in ('utf8','int64','rgb24','pcm16','position3'):
            raise ValueError('use image memory for images; unsupported modality')
        if sum(len(r.payload) for r in recognized.state.records)>16384:
            raise ValueError('modality input exceeds 16384 byte bound')
        context=json.dumps({'representation':recognized.representation,
            'metadata':{k:recognized.metadata[k] for k in ('sample_rate','channels','units') if k in recognized.metadata}},sort_keys=True)
        return recognized,context
    def observe(self,data):
        if not isinstance(data,dict) or set(data)!={'training','validation'}:
            raise ValueError('training and validation pairs required')
        splits={};context=None
        for split,minimum in [('training',2),('validation',1)]:
            items=data[split]
            if not isinstance(items,list) or not minimum<=len(items)<=20:
                raise ValueError('2..20 training and 1..20 validation pairs required')
            splits[split]=[]
            for item in items:
                if not isinstance(item,dict) or set(item)!={'before','after'}:raise ValueError('before and after required')
                a,ca=self.recognize(item['before']);b,cb=self.recognize(item['after'])
                if context is None:context=ca
                if ca!=context or cb!=context:raise ValueError('representation and format context must match throughout')
                splits[split].append((a.state,b.state))
        inputs={a.encode() for a,b in splits['training']}
        if len(inputs)<2 or inputs & {a.encode() for a,b in splits['validation']}:
            raise ValueError('distinct training inputs and held-out validation required')
        canonical=json.dumps(data,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
        fingerprint=hashlib.sha256(canonical.encode()).hexdigest()
        cached=self.db.execute('SELECT report FROM modality_programs WHERE fingerprint=?',(fingerprint,)).fetchone()
        if cached:return dict(json.loads(cached[0]),cached=True)
        rule,hypotheses=infer_rule(splits['training'],1)
        for a,b in splits['training']+splits['validation']:
            if rule.apply(a).encode()!=b.encode():raise ValueError('candidate fails observed output bytes')
        raw=rule.encode();report={'status':'learned','model':fingerprint,'context':json.loads(context),
            'hypotheses':hypotheses,'training':len(splits['training']),'validation':len(splits['validation']),
            'scope':'validated byte hypothesis; unseen outcomes remain predictions'}
        with self.db:self.db.execute('INSERT INTO modality_programs VALUES (?,?,?,?,?,?)',
            (fingerprint,raw,hashlib.sha256(raw).hexdigest(),context,canonical,json.dumps(report)))
        return report
    def models(self):
        return [json.loads(row[0]) for row in self.db.execute('SELECT report FROM modality_programs ORDER BY fingerprint')]
    def transform(self,value,model):
        recognized,context=self.recognize(value)
        row=self.db.execute('SELECT * FROM modality_programs WHERE fingerprint=?',(model,)).fetchone()
        if row is None:raise ValueError('unknown modality program')
        if context!=row['context']:raise ValueError('input representation or format context differs from learned model')
        raw=bytes(row['program'])
        if hashlib.sha256(raw).hexdigest()!=row['program_hash']:raise ValueError('corrupt modality program')
        target=Relationship.decode(raw).apply(recognized.state)
        before=recognized.state.get(1).payload;after=target.get(1).payload
        result={'status':'transformed','model':model,'representation':recognized.representation,
            'decoded':decode_outputs(target)[1],'metadata':recognized.metadata,
            'input_bytes':len(before),'output_bytes':len(after),'before_preview':before[:128].hex(' '),
            'after_preview':after[:128].hex(' '),'output_state_hex':target.encode().hex()}
        if recognized.representation=='pcm16':
            meta=dict(recognized.metadata,frames=len(after)//2);result['metadata']=meta
            wav,_=render(Recognized(target,'pcm16',meta));result['wav_base64']=base64.b64encode(wav).decode()
        return result
