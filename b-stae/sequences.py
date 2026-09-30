"""Event-conditioned behavior extraction from ordered representation states."""
from datetime import datetime,timezone
import hashlib
import itertools
import json
import math
from dataclasses import replace
from core import BinaryState,Record,BLOB,decode_outputs
from learning import infer_rule
from bound_relationships import bindings,instantiate

EVENT_ENTITY=2**32-1

def event_bytes(event):
    if not isinstance(event,dict) or not isinstance(event.get('name'),str) or not event['name'].strip():raise ValueError('event requires a nonempty name')
    raw=json.dumps(event,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()
    if len(raw)>4096:raise ValueError('event exceeds byte limit')
    return raw

def recognized_state(engine,entities,event):
    if not isinstance(entities,dict) or not entities:raise ValueError('nonempty entity map required')
    records=[]
    for key,value in entities.items():
        entity=int(key)
        if str(entity)!=str(key) or entity==EVENT_ENTITY:raise ValueError('invalid or reserved entity ID')
        recognized=engine.recognize(value,entity)
        if recognized.representation=='pcm16' and event.get('sample_rate')!=recognized.metadata['sample_rate']:raise ValueError('audio events must retain matching sample_rate')
        records.extend(recognized.state.records)
    records.append(Record(EVENT_ENTITY,BLOB,event_bytes(event)))
    return BinaryState(tuple(records))

def byte_changes(before,after):
    a={r.entity:r for r in before.records};b={r.entity:r for r in after.records}
    if {(r.entity,r.kind) for r in before.records}!={(r.entity,r.kind) for r in after.records}:raise ValueError('entity identities and types must remain aligned')
    changes=[]
    for entity in sorted(a):
        if entity==EVENT_ENTITY:continue
        left,right=a[entity].payload,b[entity].payload
        if left==right:continue
        prefix=0
        while prefix<min(len(left),len(right)) and left[prefix]==right[prefix]:prefix+=1
        suffix=0
        while suffix<min(len(left),len(right))-prefix and left[-1-suffix]==right[-1-suffix]:suffix+=1
        changes.append({'entity':entity,'type':a[entity].kind,'before_bytes':len(left),'after_bytes':len(right),
            'common_prefix_bytes':prefix,'common_suffix_bytes':suffix,'changed_before_hex':left[prefix:len(left)-suffix if suffix else None][:128].hex(' '),
            'changed_after_hex':right[prefix:len(right)-suffix if suffix else None][:128].hex(' ')})
    return changes

class SequenceExtractor:
    def __init__(self,engine):
        self.engine=engine;self.db=engine.db
        self.db.execute('''CREATE TABLE IF NOT EXISTS behavior_models (relationship_id INTEGER PRIMARY KEY,
            source_id INTEGER NOT NULL,source_hash TEXT NOT NULL,event BLOB NOT NULL,report TEXT NOT NULL)''')
    def pairs(self,sequences):
        if not isinstance(sequences,list) or not 1<=len(sequences)<=20:raise ValueError('1..20 sequences required')
        pairs=[];report=[];events=set()
        for index,sequence in enumerate(sequences):
            if not isinstance(sequence,dict) or set(sequence)!={'frames','events'}:raise ValueError('frames and events required')
            frames=sequence['frames'];steps=sequence['events']
            if not isinstance(frames,list) or not 2<=len(frames)<=50 or not isinstance(steps,list) or len(steps)!=len(frames)-1:raise ValueError('one event required between each pair of frames')
            times=[]
            for frame in frames:
                if not isinstance(frame,dict) or set(frame)!={'time','entities'}:raise ValueError('frame requires time and entities')
                t=frame['time']
                if type(t) not in (int,float) or not math.isfinite(t):raise ValueError('finite numeric timestamps required')
                times.append(t)
            if any(b<=a for a,b in zip(times,times[1:])):raise ValueError('timestamps must strictly increase')
            for offset,event in enumerate(steps):
                event_bytes(event)
                duration=times[offset+1]-times[offset]
                if 'duration' in event and event['duration']!=duration:raise ValueError('event duration differs from frame interval')
                event=dict(event,duration=duration)
                encoded=event_bytes(event);events.add(encoded)
                before=recognized_state(self.engine,frames[offset]['entities'],event)
                after=recognized_state(self.engine,frames[offset+1]['entities'],event)
                changes=byte_changes(before,after)
                pairs.append((before,after))
                report.append({'sequence':index,'transition':offset,'from_time':times[offset],'to_time':times[offset+1],
                    'event':event,'changes':changes,'entry_bytes':len(before.encode()),'exit_bytes':len(after.encode()),
                    'entry_first_hex':before.encode()[:8].hex(),'exit_last_hex':after.encode()[-8:].hex()})
        if len(events)!=1:raise ValueError('group observations by one exact event descriptor before training')
        return pairs,report,next(iter(events))
    def learn_source(self,source_id,relationship_id):
        source=self.db.execute('SELECT * FROM sources WHERE id=?',(source_id,)).fetchone()
        if source is None or source['mime']!='application/json':raise ValueError('JSON sequence source required')
        data=json.loads(self.engine.source_state(source_id).get(1).payload.decode())
        if not isinstance(data,dict) or set(data)!={'training_sequences','validation_sequences'}:raise ValueError('training_sequences and validation_sequences required')
        training,train_report,event=self.pairs(data['training_sequences'])
        validation,valid_report,other_event=self.pairs(data['validation_sequences'])
        if event!=other_event:raise ValueError('validation event differs from training')
        if len({a.encode() for a,b in training})<2:raise ValueError('two distinct training entry states required')
        if {a.encode() for a,b in training}&{a.encode() for a,b in validation}:raise ValueError('validation entry states must be held out')
        rule,hypotheses=infer_rule(training,relationship_id)
        for before,after in training+validation:
            if rule.apply(before).encode()!=after.encode():raise ValueError('candidate fails observed sequence transition')
        report={'status':'validated_on_sequences','relationship_id':rule.id,'event':json.loads(event),'hypotheses':hypotheses,
                'training_transitions':len(training),'validation_transitions':len(validation),
                'transitions':train_report+valid_report,'scope':'event-conditioned observation hypothesis; not proof of causation'}
        raw=rule.encode()
        with self.db:
            self.db.execute('INSERT INTO byte_relationships VALUES (?,?,?)',(rule.id,raw,hashlib.sha256(raw).hexdigest()))
            self.db.execute('INSERT INTO behavior_models VALUES (?,?,?,?,?)',(rule.id,source_id,source['sha256'],event,json.dumps(report)))
        return report
    def predict(self,entities,event,max_bindings=1000):
        if type(max_bindings) is not int or max_bindings<1:raise ValueError('invalid binding budget')
        encoded=event_bytes(event);state=recognized_state(self.engine,entities,event)
        ids=frozenset(row[0] for row in self.db.execute('SELECT relationship_id FROM behavior_models WHERE event=?',(encoded,)))
        if not ids:return {'status':'unknown','reason':'No behavior learned for this exact event.'}
        rules=self.engine.relationships.load();outcomes={};evidence={}
        for rid in sorted(ids):
            rule=rules[rid];count=1
            for guard in rule.guards:count*=sum(replace(guard,entity=r.entity).matches(state) for r in state.records)
            if count>max_bindings:return {'status':'bounded','reason':'Binding budget prevents unique-outcome verification.'}
            for binding in bindings(rule,state,max_bindings):
                # Event roles cannot bind to user data, even if that data has matching bytes.
                if dict(binding).get(EVENT_ENTITY)!=EVENT_ENTITY:continue
                try:after=instantiate(rule,binding).apply(state)
                except (ValueError,OverflowError):continue
                raw=after.encode();outcomes[raw]=after;evidence.setdefault(raw,[]).append({'relationship':rid,'binding':binding})
        if not outcomes:return {'status':'unknown','reason':'No applicable behavior matches this state and event.'}
        if len(outcomes)>1:return {'status':'ambiguous','reason':'Several event-conditioned outcomes match.','outcomes':len(outcomes)}
        raw,target=next(iter(outcomes.items()))
        result=self.engine.bound_relationships.resolve(state,target,max_depth=1,allowed=ids,max_bindings=max_bindings)
        if not result.accepted:return {'status':'failed','reason':result.reason}
        decoded=decode_outputs(target);decoded.pop(EVENT_ENTITY,None)
        return {'status':'predicted','event':event,'decoded':decoded,'evidence':evidence[raw],'resolution':result.source,
                'changes':byte_changes(state,target),'scope':'learned sequence outcome, not independent physical truth'}
