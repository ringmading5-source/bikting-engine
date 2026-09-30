"""Compose compatible numeric-byte transformations and plotting capabilities."""
import hashlib
import json
import math
import re
import struct
from core import BinaryState,Record,BLOB
from capabilities import Capability

class SeriesPipeline:
    def __init__(self,engine):
        self.engine=engine;self.db=engine.db
        self.engine.capabilities.register(Capability('binary.series_add','numeric_series','numeric_series','add_constant',('elementwise',),'1',self.add_bytes))
        self.db.execute('''CREATE TABLE IF NOT EXISTS series_pipeline_memory (
            boundary TEXT PRIMARY KEY, entry BLOB NOT NULL, plan TEXT NOT NULL,
            final_series BLOB NOT NULL, output_hash TEXT NOT NULL, uses INTEGER NOT NULL)''')
    def register_request(self,text,commit=True):
        if not isinstance(text,str) or len(text)>1000:return False
        clauses=re.split(r'\s+then\s+',text.strip(),flags=re.I)
        if not 2<=len(clauses)<=9:return False
        finish=' '.join(clauses[-1].lower().split())
        styles={'graph the result':'line','graph result':'line','plot the result':'line','line graph':'line','bar chart':'bar'}
        if finish not in styles:return False
        actions=[]
        for clause in clauses[:-1]:
            match=re.fullmatch(r'add\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s+to\s+every\s+value\s*,?',clause.strip(),re.I)
            if not match:return False
            amount=float(match[1])
            if not math.isfinite(amount) or abs(amount)>1e12:raise ValueError('series addition amount exceeds numeric bound')
            actions.append({'operation':'series_add','amount':amount})
        actions.append({'operation':'plot_values','style':styles[finish]})
        children=[]
        for action in actions:
            # Stable internal keys carry explicit typed parameters; their bytes
            # ground the terminal without inferring unrelated word meanings.
            key='series-terminal '+json.dumps(action,sort_keys=True,separators=(',',':'))
            self.engine.words.register(key,intent=action,commit=commit);children.append(key)
        self.engine.words.register(text,children=children,commit=commit)
        return True
    def preflight(self,actions,values):
        numbers,entry=self.engine.capabilities.series(values);state=entry;steps=[]
        if not isinstance(actions,list) or not 1<=len(actions)<=9 or any(not isinstance(action,dict) or 'operation' not in action for action in actions) or actions[-1]['operation']!='plot_values':raise ValueError('numeric chain must terminate in one plot')
        for index,action in enumerate(actions):
            if action['operation']=='series_add':
                amount=action['amount']
                if type(amount) not in (int,float) or not math.isfinite(amount) or abs(amount)>1e12:raise ValueError('invalid series addition amount')
                spec={'input_type':'numeric_series','output_type':'numeric_series','effect':'add_constant','style':'elementwise','amount':amount,'preserve_order':True}
                capability=self.engine.capabilities.select(spec)
                target_values=[math.fsum((value,amount)) for value in numbers]
                target_values,target=self.engine.capabilities.series(target_values)
                steps.append({'intent':action,'requirements':spec,'capability':capability.id,'entry_hex':state.encode().hex(),'target_hex':target.encode().hex()})
                numbers,state=target_values,target
            elif action['operation']=='plot_values':
                if index!=len(actions)-1:raise ValueError('plot output cannot feed numeric transformation')
                if action.get('style') not in ('line','bar'):raise ValueError('unsupported plot style')
                spec=self.engine.capabilities.specification('line graph' if action['style']=='line' else 'bar chart','B-STAE graph')
                capability=self.engine.capabilities.select(spec)
                steps.append({'intent':action,'requirements':spec,'capability':capability.id,'entry_hex':state.encode().hex(),'target_type':'svg'})
            else:raise ValueError('incompatible operation in numeric capability chain')
        return {'entry_hex':entry.encode().hex(),'final_series_hex':state.encode().hex(),'final_values':numbers,'steps':steps,'all_terminals_grounded':True,'ordered_targets_valid':True}
    def add_bytes(self,spec,numbers):
        _,entry=self.engine.capabilities.series(numbers)
        raw=entry.get(1).payload;count=struct.unpack('<H',raw[4:6])[0]
        if raw[:4]!=b'BNS1' or len(raw)!=6+count*8:raise ValueError('numeric byte schema mismatch')
        operand=struct.pack('<d',spec['amount']);amount=struct.unpack('<d',operand)[0]
        transformed=[]
        for offset in range(6,len(raw),8):
            value=struct.unpack('<d',raw[offset:offset+8])[0]
            transformed.append(value+amount)
        decoded,state=self.engine.capabilities.series(transformed)
        return {'values':decoded,'state_hex':state.encode().hex(),'operand_hex':operand.hex(),'verifier':'float64 operand applied to each float64 input word'}
    def execute(self,actions,values):
        plan=self.preflight(actions,values);numbers,_=self.engine.capabilities.series(values);trace=[];chart=None
        definitions=[self.engine.capabilities.registry[step['capability']] for step in plan['steps']]
        import matplotlib
        key=hashlib.sha256(json.dumps([plan,[(c.id,c.version) for c in definitions],matplotlib.__version__],sort_keys=True).encode()).hexdigest()
        old=self.db.execute('SELECT * FROM series_pipeline_memory WHERE boundary=?',(key,)).fetchone()
        # No path promotion until every step and the final plot pass verification.
        for step in plan['steps']:
            capability=self.engine.capabilities.select(step['requirements'])
            result=capability.execute(step['requirements'],numbers)
            if step['intent']['operation']=='series_add':
                if result['state_hex']!=step['target_hex']:raise ValueError('series byte transformation differs from independently preflighted target')
                numbers=result['values'];trace.append(dict(step,result=result,verified=True))
            else:
                expected=[{'x':i,'y':v} for i,v in enumerate(numbers)]
                if result['coordinates']!=expected:raise ValueError('plot coordinates differ from transformed series')
                chart=result;trace.append(dict(step,coordinates=result['coordinates'],verified=True))
        digest=hashlib.sha256(chart['svg'].encode()).hexdigest()
        with self.db:self.db.execute('INSERT OR REPLACE INTO series_pipeline_memory VALUES (?,?,?,?,?,?)',
            (key,bytes.fromhex(plan['entry_hex']),json.dumps(actions,sort_keys=True),bytes.fromhex(plan['final_series_hex']),digest,
                old['uses']+1 if old and old['output_hash']==digest else 1))
        return dict(chart,status='fulfilled',verified=True,final_values=numbers,trace=trace,plan=plan,
            resolution='reverified_pipeline_memory' if old and old['output_hash']==digest else 'composed_capabilities',
            verification_scope='numeric byte targets and plotted coordinates checked at every step; arbitrary intent and input truth are not verified')
