"""Representation-independent guarded binary rewrite relationships.

COPY, INSERT and XOR are format-neutral byte primitives, not English actions.
Typed record validation governs which resulting representations are acceptable.
"""
from dataclasses import dataclass
from collections import deque
import hashlib
import json
import struct
from core import Record,BinaryState,BinaryResult,MAX_STATE

@dataclass(frozen=True)
class Guard:
    entity: int
    kind: int
    offset: int = 0
    signature: bytes = b''
    mask: bytes = b''
    length: int = -1
    def __post_init__(self):
        if any(type(v) is not int for v in (self.entity,self.kind,self.offset,self.length)) or not 0<=self.entity<2**32 or not 1<=self.kind<=6 or self.offset<0 or self.length < -1:raise ValueError('invalid guard fields')
        if type(self.signature) is not bytes or type(self.mask) is not bytes or len(self.signature)!=len(self.mask):raise ValueError('signature/mask sizes must match')
    def matches(self,state):
        r=state.get(self.entity)
        if r is None or r.kind!=self.kind or (self.length!=-1 and len(r.payload)!=self.length):return False
        if self.offset+len(self.signature)>len(r.payload):return False
        return all(((a^b)&m)==0 for a,b,m in zip(r.payload[self.offset:],self.signature,self.mask))

@dataclass(frozen=True)
class Fragment:
    source: int = -1 # -1 means a literal; otherwise copy bytes from a participant
    offset: int = 0
    count: int = -1 # -1 means remaining payload
    literal: bytes = b''
    xor: bytes = b''
    delta: int = 0
    signed: bool = True
    def __post_init__(self):
        if any(type(v) is not int for v in (self.source,self.offset,self.count)) or self.source < -1 or self.offset<0 or self.count < -1:raise ValueError('invalid fragment')
        if type(self.literal) is not bytes or type(self.xor) is not bytes:raise TypeError('fragment payloads must be bytes')
        if type(self.delta) is not int or type(self.signed) is not bool:raise ValueError('invalid word arithmetic fields')
        if self.delta and (self.count not in (1,2,4,8) or self.xor):raise ValueError('word delta requires a fixed-width copy without XOR')
        if self.source==-1 and (self.offset!=0 or self.count!=-1 or self.xor or self.delta):raise ValueError('literal cannot have copy fields')
        if self.source!=-1 and self.literal:raise ValueError('copy cannot contain literal bytes')
    def read(self,state):
        if self.source==-1:return self.literal
        r=state.get(self.source)
        if r is None:raise ValueError('missing fragment source')
        end=len(r.payload) if self.count==-1 else self.offset+self.count
        if self.offset>len(r.payload) or end>len(r.payload):raise ValueError('copy outside source')
        data=r.payload[self.offset:end]
        if self.xor:
            if len(self.xor)!=len(data):raise ValueError('XOR mask length mismatch')
            data=bytes(a^b for a,b in zip(data,self.xor))
        if self.delta:
            data=(int.from_bytes(data,'little',signed=self.signed)+self.delta).to_bytes(self.count,'little',signed=self.signed)
        return data

@dataclass(frozen=True)
class Effect:
    entity: int
    kind: int
    fragments: tuple
    def __post_init__(self):
        if type(self.entity) is not int or not 0<=self.entity<2**32 or type(self.kind) is not int or not 1<=self.kind<=6:raise ValueError('invalid effect')
        if type(self.fragments) is not tuple or not all(isinstance(x,Fragment) for x in self.fragments):raise TypeError('immutable fragments required')

@dataclass(frozen=True)
class Relationship:
    id: int
    guards: tuple
    effects: tuple
    def __post_init__(self):
        if type(self.id) is not int or not 0<=self.id<2**32:raise ValueError('invalid relationship ID')
        if type(self.guards) is not tuple or not self.guards or not all(isinstance(g,Guard) for g in self.guards):raise ValueError('participant guards required')
        if type(self.effects) is not tuple or not self.effects or not all(isinstance(e,Effect) for e in self.effects):raise ValueError('effects required')
        if len({g.entity for g in self.guards})!=len(self.guards) or len({e.entity for e in self.effects})!=len(self.effects):raise ValueError('duplicate participant/effect')
        guarded={g.entity for g in self.guards}
        if any(f.source!=-1 and f.source not in guarded for e in self.effects for f in e.fragments):raise ValueError('all byte sources require a participant guard')
    def apply(self,state):
        if not all(g.matches(state) for g in self.guards):raise ValueError('relationship conditions not met')
        changed={}
        # All effects read the original state, making multi-participant updates simultaneous.
        for effect in self.effects:
            pieces=[];size=0
            for fragment in effect.fragments:
                part=fragment.read(state);size+=len(part)
                if size>MAX_STATE:raise ValueError('effect exceeds size limit')
                pieces.append(part)
            changed[effect.entity]=Record(effect.entity,effect.kind,b''.join(pieces))
        records={r.entity:r for r in state.records};records.update(changed)
        return BinaryState(tuple(records[k] for k in sorted(records)))
    def encode(self):
        data={'id':self.id,'guards':[[g.entity,g.kind,g.offset,g.signature.hex(),g.mask.hex(),g.length] for g in self.guards],
              'effects':[[e.entity,e.kind,[([f.source,f.offset,f.count,f.literal.hex(),f.xor.hex(),f.delta,f.signed] if f.delta else [f.source,f.offset,f.count,f.literal.hex(),f.xor.hex()]) for f in e.fragments]] for e in self.effects]}
        body=json.dumps(data,sort_keys=True,separators=(',',':')).encode()
        if len(body)>MAX_STATE:raise ValueError('relationship exceeds byte limit')
        return b'BRLT'+struct.pack('<BI',1,len(body))+body
    @classmethod
    def decode(cls,raw):
        if len(raw)<9 or len(raw)>MAX_STATE+9 or raw[:4]!=b'BRLT':raise ValueError('invalid relationship bytes')
        version,size=struct.unpack_from('<BI',raw,4)
        if version!=1 or size!=len(raw)-9:raise ValueError('relationship format mismatch')
        d=json.loads(raw[9:])
        if set(d)!={'id','guards','effects'}:raise ValueError('invalid relationship schema')
        guards=tuple(Guard(g[0],g[1],g[2],bytes.fromhex(g[3]),bytes.fromhex(g[4]),g[5]) for g in d['guards'])
        effects=tuple(Effect(e[0],e[1],tuple(Fragment(f[0],f[1],f[2],bytes.fromhex(f[3]),bytes.fromhex(f[4]),f[5] if len(f)==7 else 0,f[6] if len(f)==7 else True) for f in e[2])) for e in d['effects'])
        relationship=cls(d['id'],guards,effects)
        if relationship.encode()!=raw:raise ValueError('noncanonical relationship')
        return relationship

class RelationshipEngine:
    def __init__(self,db):
        self.db=db
        self.db.execute('CREATE TABLE IF NOT EXISTS byte_relationships (id INTEGER PRIMARY KEY, rule BLOB NOT NULL, sha256 TEXT NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS relationship_paths (boundary BLOB PRIMARY KEY, path TEXT NOT NULL, successes INTEGER NOT NULL)')
    def register(self,relationship):
        raw=relationship.encode()
        with self.db:
            if self.db.execute('SELECT 1 FROM byte_relationships WHERE id=?',(relationship.id,)).fetchone():raise ValueError('duplicate relationship ID')
            self.db.execute('INSERT INTO byte_relationships VALUES (?,?,?)',(relationship.id,raw,hashlib.sha256(raw).hexdigest()))
    def load(self):
        rules={}
        # Old inferred rules stay inspectable but cannot participate in execution.
        inferred=set()
        if self.db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='learned_relationships'").fetchone():
            inferred={row[0] for row in self.db.execute('SELECT relationship_id FROM learned_relationships')}
        for row in self.db.execute('SELECT id,rule,sha256 FROM byte_relationships ORDER BY id'):
            if row[0] in inferred:continue
            raw=bytes(row[1])
            if hashlib.sha256(raw).hexdigest()!=row[2]:raise ValueError('relationship integrity failure')
            rule=Relationship.decode(raw)
            if rule.id!=row[0]:raise ValueError('relationship ID mismatch')
            rules[rule.id]=rule
        return rules
    def execute(self,entry,target,path,rules,allowed,depth):
        if len(path)>depth:raise ValueError('path depth exceeded')
        state=entry;snapshots=[state.encode()]
        for rid in path:
            if rid not in rules or rid not in allowed:raise ValueError('relationship missing or denied')
            state=rules[rid].apply(state);snapshots.append(state.encode())
        if state.encode()!=target.encode():raise ValueError('target not verified')
        return tuple(snapshots)
    def resolve(self,entry,target,max_depth=5,max_expansions=1000,max_frontier=10000,allowed=None):
        if any(type(v) is not int for v in (max_depth,max_expansions,max_frontier)) or max_depth<0 or min(max_expansions,max_frontier)<1:raise ValueError('invalid search bounds')
        rules=self.load()
        if allowed is None:allowed=frozenset(rules)
        if not isinstance(allowed,frozenset) or any(type(x) is not int for x in allowed):raise ValueError('immutable relationship permissions required')
        key=json.dumps({'version':1,'entry':entry.encode().hex(),'target':target.encode().hex(),
            'rules':[r.encode().hex() for r in rules.values()],'allowed':sorted(allowed),'depth':max_depth},sort_keys=True,separators=(',',':')).encode()
        cached=self.db.execute('SELECT path FROM relationship_paths WHERE boundary=?',(key,)).fetchone()
        if cached:
            try:
                path=tuple(json.loads(cached[0]))
                if any(type(x) is not int for x in path):raise ValueError('invalid cached IDs')
                snapshots=self.execute(entry,target,path,rules,allowed,max_depth)
                with self.db:self.db.execute('UPDATE relationship_paths SET successes=successes+1 WHERE boundary=?',(key,))
                return BinaryResult(True,'relationship_memory','target bytes reverified',path,snapshots)
            except (ValueError,TypeError,KeyError):
                with self.db:self.db.execute('DELETE FROM relationship_paths WHERE boundary=?',(key,))
        queue=deque([(entry,())]);seen={entry.encode()};count=0
        while queue and count<max_expansions:
            state,path=queue.popleft();count+=1
            if state.encode()==target.encode():
                snapshots=self.execute(entry,target,path,rules,allowed,max_depth)
                with self.db:self.db.execute('INSERT OR REPLACE INTO relationship_paths VALUES (?,?,1)',(key,json.dumps(path)))
                return BinaryResult(True,'relationship_composition','exact target bytes verified',path,snapshots,count)
            if len(path)>=max_depth:continue
            for rid,rule in rules.items():
                if rid not in allowed:continue
                try:next_state=rule.apply(state)
                except (ValueError,OverflowError):continue
                raw=next_state.encode()
                if raw in seen:continue
                if len(queue)>=max_frontier:return BinaryResult(False,'relationship_composition','frontier exhausted',expansions=count)
                seen.add(raw);queue.append((next_state,path+(rid,)))
        return BinaryResult(False,'relationship_composition','no verified relationship path within bounds',expansions=count)
