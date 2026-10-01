"""Explicit intent adapters -> exact bounded targets -> byte-program execution."""
import base64
from collections import deque
import hashlib
import json
import re
import struct
from core import BinaryState, Record, INT64, UTF8, RGB, PCM16, POSITION3, decode_outputs
from byte_relationships import Relationship, Guard, Effect, Fragment
from recognition import Recognized
from output import render

class IntentEngine:
    def __init__(self,engine):
        self.engine=engine;self.db=engine.db
        self.db.execute('''CREATE TABLE IF NOT EXISTS intent_paths (
            boundary TEXT PRIMARY KEY, programs TEXT NOT NULL)''')
    def parse(self,request):
        if isinstance(request,dict):
            if set(request)=={'operation','amount'} and request.get('operation')=='series_add' and type(request.get('amount')) in (int,float):
                import math
                if not math.isfinite(request['amount']) or abs(request['amount'])>1e12:raise ValueError('invalid series addition amount')
                return request
            if set(request)=={'operation','style'} and request.get('operation')=='plot_values' and request.get('style') in ('line','bar'):
                return request
            if request.get('operation')=='translate' and set(request)=={'operation','delta'}:
                if not isinstance(request['delta'],list) or len(request['delta'])!=3 or any(type(x)is not int for x in request['delta']):raise ValueError('three integer deltas required')
                return request
            if request.get('operation') in ('add','brighten','sample_shift') and set(request)=={'operation','amount'} and type(request['amount'])is int:return request
            if request.get('operation')=='append' and set(request)=={'operation','text'} and isinstance(request['text'],str):return request
            raise ValueError('unsupported structured intent')
        if not isinstance(request,str) or len(request)>4096:raise ValueError('bounded intent text required')
        match=re.fullmatch(r'\s*(add|brighten|shift samples by)\s+([+-]?\d+)\s*',request,re.I)
        if match:return {'operation':{'add':'add','brighten':'brighten','shift samples by':'sample_shift'}[match[1].lower()],'amount':int(match[2])}
        match=re.fullmatch(r'\s*append\s+(".*")\s*',request,re.S|re.I)
        if match:
            text=json.loads(match[1])
            return {'operation':'append','text':text}
        match=re.fullmatch(r'\s*move by\s+([+-]?\d+)\s*,\s*([+-]?\d+)\s*,\s*([+-]?\d+)\s*',request,re.I)
        if match:return {'operation':'translate','delta':[int(match[i]) for i in (1,2,3)]}
        raise ValueError('Supported intents: add N; append "text"; brighten N; move by X,Y,Z; shift samples by N')
    def boundary(self,state,intent):
        record=state.get(1);raw=record.payload;op=intent['operation'];fragments=[]
        if op=='append':
            if record.kind!=UTF8:raise ValueError('append requires text')
            suffix=intent['text'].encode();target=raw+suffix
            fragments=[Fragment(1),Fragment(literal=suffix)]
        else:
            kind={'add':INT64,'brighten':RGB,'translate':POSITION3,'sample_shift':PCM16}[op]
            if record.kind!=kind:raise ValueError('intent does not apply to recognized representation')
            width,signed={INT64:(8,True),RGB:(1,False),POSITION3:(4,True),PCM16:(2,True)}[kind]
            deltas=intent['delta'] if op=='translate' else [intent['amount']]*(len(raw)//width)
            chunks=[]
            for index,delta in enumerate(deltas):
                offset=index*width
                value=int.from_bytes(raw[offset:offset+width],'little',signed=signed)+delta
                chunks.append(value.to_bytes(width,'little',signed=signed))
                fragments.append(Fragment(1,offset,width,delta=delta,signed=signed))
            target=b''.join(chunks)
        desired=BinaryState((Record(1,record.kind,target),))
        if len(target)>16384:raise ValueError('target exceeds modality bound')
        primitive=Relationship(1,(Guard(1,record.kind,length=len(raw)),),(Effect(1,record.kind,tuple(fragments)),))
        return desired,primitive
    def execute(self,value,request,max_depth=3,max_expansions=100):
        if type(max_depth)is not int or not 1<=max_depth<=5 or type(max_expansions)is not int or not 1<=max_expansions<=1000:raise ValueError('invalid intent search bounds')
        intent=self.parse(request)
        recognized,context=self.engine.modalities.recognize(value)
        entry=recognized.state;target,primitive=self.boundary(entry,intent)
        candidates=[]
        for row in self.db.execute('SELECT fingerprint,program,program_hash FROM stored_modality_programs WHERE context=? ORDER BY fingerprint LIMIT 101',(context,)):
            raw=bytes(row['program'])
            if hashlib.sha256(raw).hexdigest()!=row['program_hash']:continue
            candidates.append((row['fingerprint'],Relationship.decode(raw)))
        if len(candidates)>100:return {'status':'bounded','reason':'Too many applicable-context programs.'}
        key=hashlib.sha256(json.dumps([entry.encode().hex(),target.encode().hex(),context,intent,max_depth,
            [(name,rule.encode().hex()) for name,rule in candidates]],sort_keys=True).encode()).hexdigest()
        path=None;source='memory_search'
        cached=self.db.execute('SELECT programs FROM intent_paths WHERE boundary=?',(key,)).fetchone()
        if cached:
            try:
                path=[(name,Relationship.decode(bytes.fromhex(raw))) for name,raw in json.loads(cached[0])]
                state=entry
                if len(path)>max_depth:raise ValueError('cached depth exceeded')
                for name,rule in path:state=rule.apply(state)
                if state.encode()!=target.encode():raise ValueError('cached target mismatch')
                source='persistent_memory'
            except (ValueError,OverflowError,TypeError):path=None
        if path is None:
            queue=deque([(entry,[])]);seen={entry.encode()};expanded=0
            while queue and expanded<max_expansions:
                state,steps=queue.popleft();expanded+=1
                if state.encode()==target.encode():path=steps;break
                if len(steps)>=max_depth:continue
                for name,rule in candidates:
                    try:after=rule.apply(state)
                    except (ValueError,OverflowError):continue
                    raw=after.encode()
                    if sum(len(r.payload) for r in after.records)>16384:continue
                    if raw not in seen:
                        seen.add(raw);queue.append((after,steps+[(name,rule)]))
                        if len(seen)>=1000:break
                if len(seen)>=1000:break
            if path is None:path=[('registered:'+intent['operation'],primitive)];source='registered_operation'
        state=entry;trace=[]
        for name,rule in path:
            state=rule.apply(state);trace.append({'program':name,'state_hex':state.encode().hex()})
        if state.encode()!=target.encode():raise ValueError('execution failed exact target verification')
        with self.db:self.db.execute('INSERT OR REPLACE INTO intent_paths VALUES (?,?)',(key,json.dumps([(name,rule.encode().hex()) for name,rule in path])))
        result={'status':'fulfilled','intent':intent,'source':source,'decoded':decode_outputs(state)[1],
            'boundary':{'entry_hex':entry.encode().hex(),'target_hex':target.encode().hex(),'max_depth':max_depth,
                'constraints':['same representation','same format context','checked arithmetic','exact target equality']},
            'trace':trace,'verified':True}
        if recognized.representation=='pcm16':
            wav,_=render(Recognized(state,'pcm16',recognized.metadata));result['wav_base64']=base64.b64encode(wav).decode()
        return result
    def image(self,image,request):
        from image_format import image_state
        intent=self.parse(request)
        if intent['operation']!='brighten':raise ValueError('image intent currently supports brighten N')
        w,h,raw=image_state(image);amount=intent['amount']
        target=bytes(x+amount for x in raw) # Out-of-range values reject; never silently clip.
        _,rule=self.boundary(BinaryState((Record(1,RGB,raw[:3]),)),intent)
        from image_format import pixel
        output=b''.join(rule.apply(pixel(raw[i:i+3])).get(1).payload for i in range(0,len(raw),3))
        if output!=target:raise ValueError('image target verification failed')
        return {'status':'fulfilled','intent':intent,'source':'registered_operation','verified':True,
            'image':{'width':w,'height':h,'rgb_hex':output.hex()},'before_preview':raw[:48].hex(' '),'after_preview':output[:48].hex(' ')}
