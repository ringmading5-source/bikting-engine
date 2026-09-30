"""Infer bounded byte rewrite hypotheses from observations; no model calls."""
import json
import itertools
from dataclasses import replace
from core import BinaryState,Record,UTF8,MAX_STATE,INT64,POSITION3,PCM16,RGB
from byte_relationships import Guard,Effect,Fragment,Relationship
from bound_relationships import bindings,instantiate


def infer_fragments(examples):
    """Small explicit hypothesis class: copy/insert/XOR and fixed block reorder."""
    inputs=[x for x,y in examples];outputs=[y for x,y in examples]
    entity=inputs[0].entity
    # Constant outputs are a valid hypothesis but require exact input guards later.
    if all(r.payload==outputs[0].payload for r in outputs):return (Fragment(literal=outputs[0].payload),),'constant'
    if all(a.payload==b.payload for a,b in examples):return (Fragment(entity),),'copy'
    suffixes=[]
    for a,b in examples:
        if not b.payload.startswith(a.payload):break
        suffixes.append(b.payload[len(a.payload):])
    if len(suffixes)==len(examples) and len(set(suffixes))==1:
        return (Fragment(entity),Fragment(literal=suffixes[0])),'append'
    prefixes=[]
    for a,b in examples:
        if not a.payload or not b.payload.endswith(a.payload):break
        prefixes.append(b.payload[:-len(a.payload)])
    if len(prefixes)==len(examples) and len(set(prefixes))==1:
        return (Fragment(literal=prefixes[0]),Fragment(entity)),'prepend'
    if len({len(x.payload) for x in inputs+outputs})==1:
        length=len(inputs[0].payload)
        # Reorder up to eight fixed-size blocks; search budget intentionally small.
        for width in (1,2,4,8):
            if not length or length%width or length//width>8:continue
            blocks=length//width
            for order in itertools.islice(itertools.permutations(range(blocks)),1000):
                if all(b''.join(a.payload[i*width:(i+1)*width] for i in order)==b.payload for a,b in examples):
                    return tuple(Fragment(entity,i*width,width) for i in order),'block-reorder'
        widths={INT64:(8,True),POSITION3:(4,True),PCM16:(2,True),RGB:(1,False)}
        if inputs[0].kind in widths:
            width,signed=widths[inputs[0].kind]
            if length and length%width==0:
                fragments=[]
                for offset in range(0,length,width):
                    deltas={int.from_bytes(b.payload[offset:offset+width],'little',signed=signed)-int.from_bytes(a.payload[offset:offset+width],'little',signed=signed) for a,b in examples}
                    if len(deltas)!=1:break
                    fragments.append(Fragment(entity,offset,width,delta=next(iter(deltas)),signed=signed))
                if len(fragments)==length//width:return tuple(fragments),'word-delta'
        masks=[bytes(x^y for x,y in zip(a.payload,b.payload)) for a,b in examples]
        if len(set(masks))==1:return (Fragment(entity,xor=masks[0]),),'xor'
    raise ValueError('no hypothesis in supported byte transformation class')


def infer_rule(observations,relationship_id):
    schemas=[tuple((r.entity,r.kind) for r in sorted(s.records,key=lambda r:r.entity)) for pair in observations for s in pair]
    if len(set(schemas))!=1:raise ValueError('stable entity/type schema required')
    guards=[];effects=[];hypotheses=[]
    for entity,kind in schemas[0]:
        examples=[(before.get(entity),after.get(entity)) for before,after in observations]
        payloads=[a.payload for a,b in examples]
        if all(a.payload==b.payload for a,b in examples):
            # Unchanged context: exact if invariant, otherwise type/length conditions.
            if len(set(payloads))==1:guards.append(Guard(entity,kind,signature=payloads[0],mask=b'\xff'*len(payloads[0]),length=len(payloads[0])))
            else:guards.append(Guard(entity,kind,length=len(payloads[0]) if len({len(x) for x in payloads})==1 else -1))
            continue
        fragments,hypothesis=infer_fragments(examples)
        if hypothesis=='constant':
            # Do not infer arbitrary constant replacement over unseen input states.
            if len(set(payloads))!=1:raise ValueError('constant outcome with varied input needs a stronger relationship model')
            guard=Guard(entity,kind,signature=payloads[0],mask=b'\xff'*len(payloads[0]),length=len(payloads[0]))
        else:
            guard=Guard(entity,kind,length=len(payloads[0]) if len({len(x) for x in payloads})==1 else -1)
        guards.append(guard);effects.append(Effect(entity,kind,fragments));hypotheses.append(hypothesis)
    if not effects:raise ValueError('observations show no transformation')
    return Relationship(relationship_id,tuple(guards),tuple(effects)),hypotheses

class Learner:
    def __init__(self,engine):
        self.engine=engine;self.db=engine.db
        self.db.execute('''CREATE TABLE IF NOT EXISTS learned_relationships (
            relationship_id INTEGER PRIMARY KEY,source_id INTEGER NOT NULL,source_hash TEXT NOT NULL,
            training_count INTEGER NOT NULL,validation_count INTEGER NOT NULL,hypotheses TEXT NOT NULL)''')
    def learn_source(self,source_id,relationship_id):
        source=self.db.execute('SELECT * FROM sources WHERE id=?',(source_id,)).fetchone()
        if source is None or source['mime']!='application/json':raise ValueError('JSON observation source required')
        data=json.loads(self.engine.source_state(source_id).get(1).payload.decode())
        if not isinstance(data,dict) or set(data)!={'training','validation'}:raise ValueError('training and validation arrays required')
        pairs={}
        for split,minimum in [('training',2),('validation',1)]:
            items=data[split]
            if not isinstance(items,list) or not minimum<=len(items)<=100:raise ValueError('bounded train/validation observations required')
            pairs[split]=[]
            for item in items:
                if set(item)!={'before','after'}:raise ValueError('before and after bytes required')
                def observed(value):
                    if isinstance(value,str):return BinaryState.decode(bytes.fromhex(value))
                    if not isinstance(value,dict):raise ValueError('observation must be state hex or ordinary participant map')
                    records=[]
                    for key,input_value in value.items():
                        entity=int(key)
                        if str(entity)!=key:raise ValueError('canonical entity IDs required')
                        records.extend(self.engine.recognize(input_value,entity).state.records)
                    return BinaryState(tuple(records))
                pairs[split].append((observed(item['before']),observed(item['after'])))
        if len({a.encode() for a,b in pairs['training']})<2:raise ValueError('distinct training input states required')
        if {a.encode() for a,b in pairs['training']} & {a.encode() for a,b in pairs['validation']}:raise ValueError('validation inputs must be held out')
        rule,hypotheses=infer_rule(pairs['training'],relationship_id)
        for before,after in pairs['training']+pairs['validation']:
            if rule.apply(before).encode()!=after.encode():raise ValueError('inferred rule fails observed target')
        raw=rule.encode()
        import hashlib
        with self.db:
            self.db.execute('INSERT INTO byte_relationships VALUES (?,?,?)',(rule.id,raw,hashlib.sha256(raw).hexdigest()))
            self.db.execute('INSERT INTO learned_relationships VALUES (?,?,?,?,?,?)',
                (rule.id,source_id,source['sha256'],len(pairs['training']),len(pairs['validation']),json.dumps(hypotheses)))
        return {'relationship_id':rule.id,'hypotheses':hypotheses,'training':len(pairs['training']),'validation':len(pairs['validation']),
                'status':'validated_on_supplied_observations','scope':'hypothesis, not a proof of unseen-case correctness'}
    def predict(self,inputs,allowed=None,max_bindings=1000):
        if type(max_bindings) is not int or max_bindings<1:raise ValueError('invalid binding budget')
        records=[]
        for entity,value in sorted(inputs.items()):records.extend(self.engine.recognize(value,entity).state.records)
        state=BinaryState(tuple(records));rules=self.engine.relationships.load()
        if allowed is None:allowed=frozenset(rules)
        if not isinstance(allowed,frozenset):raise ValueError('immutable relationship permissions required')
        outcomes={};evidence={}
        for rid,rule in rules.items():
            if rid not in allowed:continue
            combinations=1
            for guard in rule.guards:
                combinations*=sum(replace(guard,entity=r.entity).matches(state) for r in state.records)
            if combinations>max_bindings:
                return {'status':'bounded','reason':'Cannot establish unique outcome within binding budget.'},None
            for binding in bindings(rule,state,max_bindings):
                try:after=instantiate(rule,binding).apply(state)
                except (ValueError,OverflowError):continue
                raw=after.encode()
                if raw==state.encode():continue
                outcomes[raw]=after;evidence.setdefault(raw,[]).append({'relationship':rid,'binding':binding})
        if not outcomes:return {'status':'unknown','reason':'No applicable relationship outcome.'},None
        if len(outcomes)>1:return {'status':'ambiguous','reason':'Several byte outcomes are supported; supply a goal.','outcomes':len(outcomes)},None
        raw,target=next(iter(outcomes.items()))
        result=self.engine.bound_relationships.resolve(state,target,max_depth=1,max_bindings=max_bindings,allowed=allowed)
        return {'status':'predicted' if result.accepted else 'failed','reason':result.reason,'evidence':evidence[raw],
                'scope':'unique applicable rule outcome; not inferred user intent'},result
