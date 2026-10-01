"""Explicit source-backed procedure storage and format-conditioned retrieval."""
import base64
import hashlib
import json
from recognition import Recognized
from core import decode_outputs
from byte_relationships import Relationship
from output import render

class ModalityMemory:
    def __init__(self,engine):
        self.engine=engine;self.db=engine.db
        self.db.execute('''CREATE TABLE IF NOT EXISTS stored_modality_programs (
            fingerprint TEXT PRIMARY KEY, program BLOB NOT NULL, program_hash TEXT NOT NULL,
            context TEXT NOT NULL, observations TEXT NOT NULL, report TEXT NOT NULL)''')
    def recognize(self,value):
        recognized=self.engine.recognize(value)
        if recognized.representation not in ('utf8','int64','rgb24','pcm16','position3'):
            raise ValueError('unsupported modality for this procedure')
        if sum(len(r.payload) for r in recognized.state.records)>16384:
            raise ValueError('modality input exceeds 16384 byte bound')
        context=json.dumps({'representation':recognized.representation,
            'metadata':{k:recognized.metadata[k] for k in ('sample_rate','channels','units') if k in recognized.metadata}},sort_keys=True)
        return recognized,context
    def register(self,value,intent,source):
        if not isinstance(source,str) or not source.strip() or len(source)>2000:
            raise ValueError('bounded source reference required')
        recognized,context=self.recognize(value)
        parsed=self.engine.intents.parse(intent)
        target,rule=self.engine.intents.boundary(recognized.state,parsed)
        if rule.apply(recognized.state).encode()!=target.encode():
            raise ValueError('explicit procedure fails exact target verification')
        raw=rule.encode()
        contract=json.dumps({'context':context,'intent':parsed,'source':source},sort_keys=True)
        fingerprint=hashlib.sha256((contract+raw.hex()).encode()).hexdigest()
        report={'status':'registered','program':fingerprint,'source':source,
            'context':json.loads(context),'intent':parsed,'scope':'explicit procedure, no inferred behavior'}
        with self.db:self.db.execute('INSERT OR REPLACE INTO stored_modality_programs VALUES (?,?,?,?,?,?)',
            (fingerprint,raw,hashlib.sha256(raw).hexdigest(),context,contract,json.dumps(report)))
        return report
    def programs(self):
        return [json.loads(row[0]) for row in self.db.execute('SELECT report FROM stored_modality_programs ORDER BY fingerprint')]
    def transform(self,value,program):
        recognized,context=self.recognize(value)
        row=self.db.execute('SELECT * FROM stored_modality_programs WHERE fingerprint=?',(program,)).fetchone()
        if row is None:raise ValueError('unknown modality program')
        if context!=row['context']:raise ValueError('input representation or format context differs from stored procedure')
        raw=bytes(row['program'])
        if hashlib.sha256(raw).hexdigest()!=row['program_hash']:raise ValueError('corrupt modality program')
        target=Relationship.decode(raw).apply(recognized.state)
        before=recognized.state.get(1).payload;after=target.get(1).payload
        result={'status':'transformed','program':program,'representation':recognized.representation,
            'decoded':decode_outputs(target)[1],'metadata':recognized.metadata,
            'input_bytes':len(before),'output_bytes':len(after),'before_preview':before[:128].hex(' '),
            'after_preview':after[:128].hex(' '),'output_state_hex':target.encode().hex()}
        if recognized.representation=='pcm16':
            meta=dict(recognized.metadata,frames=len(after)//2);result['metadata']=meta
            wav,_=render(Recognized(target,'pcm16',meta));result['wav_base64']=base64.b64encode(wav).decode()
        return result
