"""Source-defined request relationships compile into explicit binary boundaries."""
from dataclasses import dataclass
import json
import struct
import unicodedata
from core import *
from recognition import Recognized

SCHEMAS={'add':('int64',ADD),'append':('utf8',APPEND),'shift':('rgb24',COLOR_SHIFT),'gain':('pcm16',GAIN)}

def phrase(s):
    if not isinstance(s,str) or not s.strip() or len(s)>200:raise ValueError('invalid request phrase')
    return ' '.join(unicodedata.normalize('NFKC',s).casefold().split())

def validate_rule(rule):
    if not isinstance(rule,dict) or set(rule)!={'request','representation','operation','operand','steps'}:raise ValueError('invalid recipe schema')
    phrase(rule['request'])
    if rule['operation'] not in SCHEMAS or rule['representation']!=SCHEMAS[rule['operation']][0]:raise ValueError('unknown representation/operation relationship')
    if type(rule['steps']) is not int or not 1<=rule['steps']<=16:raise ValueError('recipe steps must be 1..16')
    op,x=rule['operation'],rule['operand']
    if op=='add':
        if type(x) is not int:raise ValueError('integer operand required')
        params=struct.pack('<q',x)
    elif op=='append':
        if not isinstance(x,str) or len(x.encode())>4096:raise ValueError('bounded text operand required')
        params=x.encode()
    else:
        count=3 if op=='shift' else 2
        if not isinstance(x,list) or len(x)!=count or any(type(v) is not int for v in x):raise ValueError('integer operand array required')
        params=struct.pack('<hhh' if op=='shift' else '<ii',*x)
    validate_instruction(Instruction(SCHEMAS[op][1],1,params))
    return params

@dataclass(frozen=True)
class Plan:
    entry: Recognized
    target: Recognized
    instruction: Instruction
    steps: int
    evidence: tuple

class IntentBridge:
    def __init__(self,engine):self.engine=engine
    def rules(self):
        matches=[];errors=[]
        rows=self.engine.db.execute('''SELECT * FROM sources s WHERE mime='application/json'
            AND id=(SELECT MAX(id) FROM sources v WHERE v.source=s.source) ORDER BY id''').fetchall()
        for row in rows:
            try:
                # Read through validated binary source memory, not untracked snippets.
                data=json.loads(self.engine.source_state(row['id']).get(1).payload.decode())
                if not isinstance(data,dict) or 'recipes' not in data:continue
                if not isinstance(data['recipes'],list) or len(data['recipes'])>100:raise ValueError('bounded recipes array required')
                validated=[(r,validate_rule(r)) for r in data['recipes']]
                for rule,params in validated:
                    matches.append((rule,params,{'source_id':row['id'],'source':row['source'],'sha256':row['sha256'],'rule':rule}))
            except (ValueError,TypeError,struct.error,OverflowError) as error:
                errors.append({'source_id':row['id'],'reason':str(error)})
        return matches,errors
    def plan(self,value,request,max_depth=16,allowed=frozenset({1,2,3,4,5})):
        recognized=self.engine.recognize(value)
        rules,errors=self.rules()
        candidates=[x for x in rules if phrase(x[0]['request'])==phrase(request) and x[0]['representation']==recognized.representation]
        if not candidates:return None,{'status':'unsupported','reason':'No valid source recipe matches request and representation.','invalid_sources':errors}
        definitions={json.dumps({k:v for k,v in x[0].items() if k!='request'},sort_keys=True) for x in candidates}
        if len(definitions)>1:return None,{'status':'ambiguous','reason':'Sources define conflicting transformations.','evidence':[x[2] for x in candidates]}
        rule,params,_=candidates[0];opcode=SCHEMAS[rule['operation']][1]
        if opcode not in allowed:return None,{'status':'denied','reason':'Recipe operation is outside allowed opcodes.'}
        if rule['steps']>max_depth:return None,{'status':'bounded','reason':'Recipe exceeds permitted transition depth.'}
        if len(recognized.state.records)!=1:return None,{'status':'unsupported','reason':'Recipe requires a single-record representation.'}
        record=recognized.state.records[0];steps=rule['steps'];x=rule['operand']
        # Build target from declared value-level goal rules, separately from apply().
        if opcode==ADD:payload=struct.pack('<q',struct.unpack('<q',record.payload)[0]+x*steps)
        elif opcode==APPEND:payload=record.payload+x.encode()*steps
        elif opcode==COLOR_SHIFT:
            channels=[a+b*steps for a,b in zip(record.payload,x)]
            if any(not 0<=v<=255 for v in channels):raise ValueError('target RGB outside range')
            payload=bytes(channels)
        else:
            samples=[s[0] for s in struct.iter_unpack('<h',record.payload)]
            for _ in range(steps):
                samples=[max(-32768,min(32767,(abs(s*x[0])//x[1])*(-1 if s*x[0]<0 else 1))) for s in samples]
            payload=b''.join(struct.pack('<h',s) for s in samples)
        target=Recognized(recognized.state.replace(Record(record.entity,record.kind,payload)),recognized.representation,recognized.metadata)
        return Plan(recognized,target,Instruction(opcode,record.entity,params),steps,tuple(x[2] for x in candidates)),{'status':'planned'}
    def fulfill(self,value,request,max_depth=16,allowed=frozenset({1,2,3,4,5})):
        if type(max_depth) is not int or max_depth<0:raise ValueError('invalid depth')
        if not isinstance(allowed,frozenset) or any(type(v) is not int or v not in (1,2,3,4,5) for v in allowed):raise ValueError('registered immutable permissions required')
        try:plan,status=self.plan(value,request,max_depth,allowed)
        except (ValueError,OverflowError,struct.error) as error:return {'status':'invalid','reason':str(error)},None,None
        if plan is None:return status,None,None
        # Temporary registry is restricted to the compiled, allowlisted instruction.
        # Engine is a local synchronous object; concurrent calls are unsupported.
        previous=self.engine.instructions
        try:
            self.engine.instructions=(plan.instruction.encode(),)
            result=self.engine.resolve(plan.entry.state,plan.target.state,max_depth=plan.steps,allowed=allowed)
        finally:self.engine.instructions=previous
        return {'status':'verified' if result.accepted else 'failed','reason':result.reason,
                'resolution':result.source,'evidence':list(plan.evidence),'steps':len(result.program),
                'verification_scope':'declared recipe outcome, not independently established source truth'},plan,result
