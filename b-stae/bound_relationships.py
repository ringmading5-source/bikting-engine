"""Bind relationship roles to compatible participants, then compose byte interactions."""
from dataclasses import replace
from collections import deque
import itertools
import json
from core import BinaryResult
from byte_relationships import Relationship,Fragment,Effect


def bindings(rule,state,limit=1000):
    if any(e.entity not in {g.entity for g in rule.guards} for e in rule.effects):
        # New-record effects need an explicit allocation policy; fixed resolver supports them.
        return
    options=[]
    for guard in rule.guards:
        options.append([r.entity for r in sorted(state.records,key=lambda r:r.entity)
                        if replace(guard,entity=r.entity).matches(state)])
    for count,actual in enumerate(itertools.product(*options)):
        if count>=limit:break
        if len(set(actual))!=len(actual):continue
        yield tuple(zip((g.entity for g in rule.guards),actual))


def instantiate(rule,binding):
    mapping=dict(binding)
    if set(mapping)!={g.entity for g in rule.guards} or len(set(mapping.values()))!=len(mapping):raise ValueError('invalid participant binding')
    guards=tuple(replace(g,entity=mapping[g.entity]) for g in rule.guards)
    effects=tuple(Effect(mapping[e.entity],e.kind,tuple(replace(f,source=mapping[f.source]) if f.source!=-1 else f for f in e.fragments)) for e in rule.effects)
    return Relationship(rule.id,guards,effects)

class BoundResolver:
    def __init__(self,relationships):
        self.relationships=relationships;self.db=relationships.db
        self.db.execute('CREATE TABLE IF NOT EXISTS bound_paths (boundary BLOB PRIMARY KEY,path TEXT NOT NULL,successes INTEGER NOT NULL)')
    def execute(self,entry,target,path,rules,allowed,depth):
        if len(path)>depth:raise ValueError('depth exceeded')
        state=entry;snapshots=[state.encode()]
        for rid,binding in path:
            if rid not in allowed or rid not in rules:raise ValueError('relationship denied or missing')
            state=instantiate(rules[rid],binding).apply(state);snapshots.append(state.encode())
        if state.encode()!=target.encode():raise ValueError('target bytes not reached')
        return tuple(snapshots)
    def resolve(self,entry,target,max_depth=5,max_expansions=1000,max_frontier=10000,max_bindings=1000,allowed=None):
        if any(type(v) is not int for v in (max_depth,max_expansions,max_frontier,max_bindings)) or max_depth<0 or min(max_expansions,max_frontier,max_bindings)<1:raise ValueError('invalid bounds')
        rules=self.relationships.load()
        if allowed is None:allowed=frozenset(rules)
        if not isinstance(allowed,frozenset) or any(type(v) is not int for v in allowed):raise ValueError('immutable relationship permissions required')
        key=json.dumps({'version':1,'entry':entry.encode().hex(),'target':target.encode().hex(),'rules':[r.encode().hex() for r in rules.values()],
                        'allowed':sorted(allowed),'depth':max_depth},sort_keys=True,separators=(',',':')).encode()
        row=self.db.execute('SELECT path FROM bound_paths WHERE boundary=?',(key,)).fetchone()
        if row:
            try:
                raw=json.loads(row[0]);path=tuple((rid,tuple(tuple(pair) for pair in binding)) for rid,binding in raw)
                snapshots=self.execute(entry,target,path,rules,allowed,max_depth)
                with self.db:self.db.execute('UPDATE bound_paths SET successes=successes+1 WHERE boundary=?',(key,))
                return BinaryResult(True,'bound_relationship_memory','target bytes reverified',path,snapshots)
            except (ValueError,TypeError,KeyError):
                with self.db:self.db.execute('DELETE FROM bound_paths WHERE boundary=?',(key,))
        queue=deque([(entry,())]);seen={entry.encode()};count=0
        while queue and count<max_expansions:
            state,path=queue.popleft();count+=1
            if state.encode()==target.encode():
                snapshots=self.execute(entry,target,path,rules,allowed,max_depth)
                with self.db:self.db.execute('INSERT OR REPLACE INTO bound_paths VALUES (?,?,1)',(key,json.dumps(path)))
                return BinaryResult(True,'bound_relationship_composition','target bytes verified',path,snapshots,count)
            if len(path)>=max_depth:continue
            for rid,rule in rules.items():
                if rid not in allowed:continue
                for binding in bindings(rule,state,max_bindings):
                    try:next_state=instantiate(rule,binding).apply(state)
                    except (ValueError,OverflowError):continue
                    raw=next_state.encode()
                    if raw in seen:continue
                    if len(queue)>=max_frontier:return BinaryResult(False,'bound_relationship_composition','frontier exhausted',expansions=count)
                    seen.add(raw);queue.append((next_state,path+((rid,binding),)))
        return BinaryResult(False,'bound_relationship_composition','no verified bound path within limits',expansions=count)
