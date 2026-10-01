"""Versioned executable behavior specifications with typed selection and checks.

The stored descriptor references an installed deterministic implementation.
Descriptors are data, never arbitrary code loaded from a database or a model.
"""
import hashlib
import json
import re
from core import BinaryState, Record, UTF8, BLOB
from recognition import recognize
from representation import canonical

SPECS = {
    'multiply': ('int64', 'int64', 'integer multiplication', 'inverse product identity'),
    'divide_exact': ('int64', 'int64', 'exact integer division', 'nonzero divisor, zero remainder and quotient identity'),
    'uppercase': ('utf8', 'utf8', 'Unicode uppercase', 'idempotence and Unicode uppercase equality'),
    'lowercase': ('utf8', 'utf8', 'Unicode lowercase', 'idempotence and Unicode lowercase equality'),
    'trim': ('utf8', 'utf8', 'remove boundary whitespace', 'interior retained; boundaries trimmed'),
    'replace': ('utf8', 'utf8', 'literal nonempty substring replacement', 'split-and-join reference'),
    'text_length': ('utf8', 'int64', 'count Unicode code points', 'code point iteration count'),
    'sort_ascending': ('integer_series', 'integer_series', 'ascending ordering', 'ordered and multiset preserved'),
    'sort_descending': ('integer_series', 'integer_series', 'descending ordering', 'ordered and multiset preserved'),
    'series_sum': ('integer_series', 'int64', 'sum series', 'independent incremental accumulation'),
    'series_count': ('integer_series', 'int64', 'count series entries', 'enumerated entry count'),
}


def typed(value):
    if type(value)is int and not -(2**63)<=value<2**63:raise ValueError('int64 overflow')
    if isinstance(value,list):
        if not 1<=len(value)<=512 or any(type(x)is not int or not -(2**63)<=x<2**63 for x in value): raise ValueError('1..512 int64 series entries required')
        return 'integer_series',BinaryState((Record(1,BLOB,b'BIS1'+canonical(value)),))
    result=recognize(value)
    if sum(len(r.payload) for r in result.state.records)>16384:raise ValueError('behavior input byte budget exceeded')
    return result.representation,result.state

class BehaviorLibrary:
    def __init__(self,engine):
        self.engine,self.db=engine,engine.db
        self.db.execute('CREATE TABLE IF NOT EXISTS executable_behaviors (id TEXT PRIMARY KEY, specification TEXT NOT NULL, digest TEXT NOT NULL)')
        with self.db:
            for operation,(before,after,effect,verifier) in SPECS.items():
                spec={'id':operation,'version':1,'input_type':before,'output_type':after,'effect':effect,'verifier':verifier,'implementation':'behavior_library:'+operation,'source':'builtin:behavior-library-v1','bounds':{'input_bytes':16384,'series_items':512,'integer_bits':64}}
                raw=canonical(spec)
                self.db.execute('INSERT OR REPLACE INTO executable_behaviors VALUES (?,?,?)',(operation,raw.decode(),hashlib.sha256(raw).hexdigest()))
    def inventory(self):
        result=[]
        for row in self.db.execute('SELECT * FROM executable_behaviors ORDER BY id'):
            raw=row['specification'].encode()
            if hashlib.sha256(raw).hexdigest()!=row['digest']:raise ValueError('corrupt behavior specification')
            result.append(json.loads(raw))
        return result
    def fingerprint(self):return hashlib.sha256(canonical(self.inventory())).hexdigest()
    def parse(self,text):
        if not isinstance(text,str) or len(text)>2000:raise ValueError('bounded behavior request required')
        patterns=[(r'\s*multiply(?: by)? ([+-]?\d+)\s*','multiply'),(r'\s*divide(?: exactly)?(?: by)? ([+-]?\d+)\s*','divide_exact')]
        for pattern,op in patterns:
            match=re.fullmatch(pattern,text,re.I)
            if match:return {'operation':op,'amount':int(match[1])}
        names={'uppercase':'uppercase','make uppercase':'uppercase','lowercase':'lowercase','make lowercase':'lowercase','trim':'trim','trim whitespace':'trim','count characters':'text_length','sort ascending':'sort_ascending','sort descending':'sort_descending','sum values':'series_sum','count values':'series_count'}
        key=' '.join(text.casefold().split())
        if key in names:return {'operation':names[key]}
        match=re.fullmatch(r'\s*replace ("(?:[^"\\]|\\.)*") with ("(?:[^"\\]|\\.)*")\s*',text,re.I)
        if match:return {'operation':'replace','old':json.loads(match[1]),'new':json.loads(match[2])}
        return self.engine.intents.parse(text)
    def apply(self,value,action):
        if not isinstance(action,dict):raise ValueError('structured action required')
        op=action.get('operation');kind,before=typed(value)
        if op not in SPECS:
            intent=self.engine.intents.parse(action)
            target,rule=self.engine.intents.boundary(before,intent)
            observed=rule.apply(before)
            if observed.encode()!=target.encode():raise ValueError('primitive verification failed')
            from core import decode_outputs
            out=decode_outputs(observed)[1]
            if kind=='pcm16':out={'audio':{'samples':out,'sample_rate':recognize(value).metadata['sample_rate']}}
            elif kind=='position3':out={'position':out}
            elif kind=='rgb24':out=out['hex']
            return out,{'behavior':'primitive:'+op,'before':hashlib.sha256(before.encode()).hexdigest(),'after':hashlib.sha256(target.encode()).hexdigest(),'verified':True}
        spec=next((s for s in self.inventory() if s['id']==op),None)
        if spec is None or spec['input_type']!=kind or spec['version']!=1:raise ValueError('behavior precondition/type mismatch')
        required={'multiply':{'operation','amount'},'divide_exact':{'operation','amount'},'replace':{'operation','old','new'}}.get(op,{'operation'})
        if set(action)!=required:raise ValueError('invalid behavior parameters')
        if op in ('multiply','divide_exact'):
            amount=action['amount']
            if type(amount)is not int or not -(2**63)<=amount<2**63:raise ValueError('int64 parameter required')
            if op=='multiply':
                out=value*amount
                valid=(out==0 if amount==0 else out%amount==0 and out//amount==value)
            else:
                if amount==0 or value%amount:raise ValueError('exact division requires nonzero divisor and zero remainder')
                out=value//amount;valid=out*amount==value
        elif op=='uppercase':out=value.upper();valid=out.upper()==out and out==''.join(c.upper() for c in value)
        elif op=='lowercase':out=value.lower();valid=out.lower()==out and out==value.lower()
        elif op=='trim':out=value.strip();valid=out==value.lstrip().rstrip()
        elif op=='replace':
            old,new=action['old'],action['new']
            if not isinstance(old,str) or not old or not isinstance(new,str) or len(old.encode())+len(new.encode())>4096:raise ValueError('bounded literal replacement required')
            out=value.replace(old,new);valid=out==new.join(value.split(old))
        elif op in ('sort_ascending','sort_descending'):
            from collections import Counter
            reverse=op=='sort_descending';out=sorted(value,reverse=reverse)
            valid=Counter(out)==Counter(value) and all((a>=b if reverse else a<=b) for a,b in zip(out,out[1:]))
        elif op=='series_sum':
            out=sum(value);reference=0
            for entry in value:reference+=entry
            valid=out==reference
        elif op=='series_count':out=len(value);valid=out==sum(1 for _ in value)
        else:out=len(value);valid=out==sum(1 for _ in value)
        after_kind,after=typed(out)  # Validates result bounds/overflow and representation.
        if after_kind!=spec['output_type'] or not valid:raise ValueError('behavior result verification failed')
        return out,{'behavior':op,'version':1,'input_type':kind,'output_type':after_kind,'before':hashlib.sha256(before.encode()).hexdigest(),'after':hashlib.sha256(after.encode()).hexdigest(),'verifier':spec['verifier'],'verified':True}
