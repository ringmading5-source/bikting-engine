"""Evidence-aligned transfer with explicit conditions and knowledge-gap reports.

Copy bindings are learned from paired domain/canonical states. Their semantic
validity and required conditions are supplied evidence, not discovered physics.
"""
import hashlib
import json
from pattern_memory import encoded

class TransferLearning:
    def __init__(self,engine):
        self.engine,self.db=engine,engine.db
        self.db.executescript('''CREATE TABLE IF NOT EXISTS transfer_adapters
            (id TEXT PRIMARY KEY, payload TEXT NOT NULL, active INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS transfer_feedback
            (id INTEGER PRIMARY KEY, adapter TEXT NOT NULL, payload TEXT NOT NULL)''')

    def learn(self,examples,requirements,contexts,source):
        if not isinstance(examples,list) or not 3<=len(examples)<=32:raise ValueError('3..32 aligned state pairs required')
        self.engine.behavior.source(source)
        if not isinstance(requirements,dict) or not 1<=len(requirements)<=8 or any(
            not isinstance(k,str) or not 1<=len(k)<=64 or type(v) not in (str,bool,int) or
            (isinstance(v,str) and not 1<=len(v)<=128) for k,v in requirements.items()):
            raise ValueError('1..8 explicit scalar condition requirements required')
        if not isinstance(contexts,list) or not 1<=len(contexts)<=8 or len({encoded(c) for c in contexts})!=len(contexts):
            raise ValueError('1..8 distinct behavior contexts required')
        for pair in examples:
            if not isinstance(pair,dict) or set(pair)!={'domain','canonical'}:raise ValueError('aligned domain/canonical states required')
            self.engine.behavior.state(pair['domain']);self.engine.behavior.state(pair['canonical'])
        domain=sorted(examples[0]['domain']);canonical=sorted(examples[0]['canonical'])
        if len(domain)!=len(canonical) or any(sorted(p['domain'])!=domain or sorted(p['canonical'])!=canonical for p in examples):
            raise ValueError('consistent equal-width state schemas required')
        if len({encoded(p['domain']) for p in examples})<3:raise ValueError('three distinct aligned domain states required')
        choices={target:[field for field in domain if all(type(p['domain'][field]) is type(p['canonical'][target]) and
            p['domain'][field]==p['canonical'][target] for p in examples)] for target in canonical}
        if any(len(c)!=1 for c in choices.values()):
            return {'status':'ambiguous' if all(choices.values()) else 'unsupported','bindings':choices,'model_calls':0}
        bindings={k:v[0] for k,v in choices.items()}
        if len(set(bindings.values()))!=len(domain):return {'status':'ambiguous','reason':'bindings are not one-to-one','model_calls':0}
        payload={'examples':examples,'bindings':bindings,'requirements':requirements,'contexts':contexts,'source':source}
        ident=hashlib.sha256(encoded(payload).encode()).hexdigest()
        with self.db:self.db.execute('INSERT OR IGNORE INTO transfer_adapters VALUES (?,?,1)',(ident,encoded(payload)))
        active=bool(self.db.execute('SELECT active FROM transfer_adapters WHERE id=?',(ident,)).fetchone()[0])
        return {'status':'learned','adapter':ident,'active':active,'bindings':bindings,'model_calls':0,
                'scope':'copy alignment from supplied correspondences; no inferred unit conversions or causal equivalence'}

    def get(self,ident):
        row=self.db.execute('SELECT * FROM transfer_adapters WHERE id=?',(ident,)).fetchone()
        if row is None:return None,None
        if hashlib.sha256(row['payload'].encode()).hexdigest()!=row['id']:raise ValueError('corrupt transfer evidence')
        return json.loads(row['payload']),bool(row['active'])

    def translate(self,payload,state):
        self.engine.behavior.state(state)
        if set(state)!=set(payload['bindings'].values()):raise ValueError('domain state does not match learned schema')
        return {target:state[field] for target,field in payload['bindings'].items()}

    def solve(self,initial,target,adapter,conditions,max_depth=4,max_nodes=128):
        if not isinstance(adapter,str) or not isinstance(conditions,dict):raise ValueError('adapter ID and condition observations required')
        payload,active=self.get(adapter)
        if payload is None:return {'status':'needs_information','missing':['aligned domain examples'],'model_calls':0}
        if not active:return {'status':'contested','reason':'adapter rejected by counterevidence','model_calls':0}
        missing=[k for k in payload['requirements'] if k not in conditions]
        conflicts=[k for k,v in payload['requirements'].items() if k in conditions and encoded(conditions[k])!=encoded(v)]
        if conflicts:return {'status':'not_applicable','conflicting_conditions':conflicts,'missing_conditions':missing,'model_calls':0}
        if missing:return {'status':'needs_information','missing_conditions':missing,
                           'question':'Provide observed values for: '+', '.join(missing),'model_calls':0}
        self.engine.behavior.state(initial);self.engine.behavior.state(target)
        fields=set(payload['bindings'].values())
        missing_state={role:sorted(fields-set(value)) for role,value in [('initial',initial),('target',target)] if fields-set(value)}
        unexpected={role:sorted(set(value)-fields) for role,value in [('initial',initial),('target',target)] if set(value)-fields}
        if unexpected:return {'status':'not_applicable','unexpected_state_fields':unexpected,'model_calls':0}
        if missing_state:return {'status':'needs_information','missing_state_fields':missing_state,'model_calls':0}
        start=self.translate(payload,initial);goal=self.translate(payload,target)
        planned=self.engine.composition.solve(start,goal,payload['contexts'],max_depth,max_nodes)
        if planned['status']!='goal_satisfied':return {**planned,'adapter':adapter,'transfer_applied':False}
        reverse=lambda state:{payload['bindings'][k]:v for k,v in state.items()}
        return {**planned,'canonical_result':planned['result'],'result':reverse(planned['result']),
                'domain_plan':[{'before':reverse(p['before']),'after':reverse(p['after']),'context':p['context'],'model_id':p['model_id']} for p in planned['plan']],
                'adapter':adapter,'transfer_applied':True,'alignment_source':payload['source'],
                'conditions':conditions,'scope':'conditional transfer under supplied alignments and learned behavior hypotheses; no universal or physical-world verification'}

    def feedback(self,adapter,example,source):
        payload,active=self.get(adapter)
        if payload is None:raise ValueError('unknown adapter')
        self.engine.behavior.source(source)
        if not isinstance(example,dict) or set(example)!={'domain','canonical'}:raise ValueError('aligned counterexample required')
        expected=self.translate(payload,example['domain']);self.engine.behavior.state(example['canonical'])
        supported=encoded(expected)==encoded(example['canonical'])
        with self.db:
            self.db.execute('INSERT INTO transfer_feedback(adapter,payload) VALUES (?,?)',(adapter,encoded({'example':example,'source':source,'supported':supported})))
            if not supported:self.db.execute('UPDATE transfer_adapters SET active=0 WHERE id=?',(adapter,))
        return {'status':'supported_on_example' if supported else 'adapter_disabled','active':bool(active and supported),'history_retained':True}
