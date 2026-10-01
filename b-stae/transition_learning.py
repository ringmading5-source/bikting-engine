"""Context-gated affine transition hypotheses over named int64 state fields.

Exact arithmetic, held-out validation and finite evidence; no causal claim.
Predictions transform simulated data only, never operate external equipment.
"""
from fractions import Fraction
import hashlib
import json
from representation import canonical


def state(value):
    if not isinstance(value,dict) or not 1<=len(value)<=16 or any(not isinstance(k,str) or not 1<=len(k)<=64 or type(v)is not int or not -(2**63)<=v<2**63 for k,v in value.items()):
        raise ValueError('state requires 1..16 named int64 fields')
    return value


def gate(action,context,relationships):
    if not isinstance(action,str) or not 1<=len(action)<=128:raise ValueError('bounded action label required')
    if not isinstance(context,dict) or not 1<=len(context)<=16 or any(not isinstance(k,str) or not 1<=len(k)<=64 or not isinstance(v,str) or not 1<=len(v)<=128 for k,v in context.items()):raise ValueError('bounded string context fields required')
    if not isinstance(relationships,list) or len(relationships)>32:raise ValueError('bounded relationship list required')
    for relation in relationships:
        if not isinstance(relation,dict) or set(relation)!={'from','kind','to'} or any(not isinstance(v,str) or not 1<=len(v)<=128 for v in relation.values()):raise ValueError('explicit relationship triplets required')
    relations=sorted(relationships,key=canonical)
    if len({canonical(r) for r in relations})!=len(relations):raise ValueError('duplicate relationships')
    return {'action':action,'context':context,'relationships':relations}


class TransitionLearning:
    def __init__(self,engine):
        self.db=engine.db
        self.db.execute('CREATE TABLE IF NOT EXISTS contextual_transition_models (id TEXT PRIMARY KEY, payload TEXT NOT NULL, active INTEGER NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS transition_observations (id INTEGER PRIMARY KEY, role TEXT NOT NULL, payload TEXT NOT NULL)')
    def observation(self,value):
        if not isinstance(value,dict) or set(value)!={'before','after','action','context','relationships','outcome','source'}:raise ValueError('complete transition observation required')
        state(value['before']);state(value['after'])
        if set(value['before'])!=set(value['after']):raise ValueError('before/after field schemas must match')
        if value['outcome']!='observed' or not isinstance(value['source'],str) or not 1<=len(value['source'])<=256:raise ValueError('observed outcome and evidence source required')
        return gate(value['action'],value['context'],value['relationships'])
    def apply(self,model,value,reverse=False):
        state(value)
        if set(value)!=set(model['coefficients']):raise ValueError('model field schema mismatch')
        result={}
        for field,x in value.items():
            coefficient=model['coefficients'][field]
            a=Fraction(*coefficient['a']);b=Fraction(*coefficient['b'])
            if reverse and not a:raise ValueError('transition is not invertible')
            y=(Fraction(x)-b)/a if reverse else a*x+b
            if y.denominator!=1 or not -(2**63)<=y.numerator<2**63:raise ValueError('predicted state violates int64 representation')
            result[field]=y.numerator
        return result
    def learn(self,examples,validation):
        if not isinstance(examples,list) or not 3<=len(examples)<=32 or not isinstance(validation,list) or not 1<=len(validation)<=16:raise ValueError('3..32 training and 1..16 held-out observations required')
        first_gate=self.observation(examples[0]);schema=set(examples[0]['before'])
        train=set();held=set()
        for role,observations,seen in [('training',examples,train),('held_out',validation,held)]:
            for observation in observations:
                observed_gate=self.observation(observation)
                if canonical(observed_gate)!=canonical(first_gate) or set(observation['before'])!=schema:raise ValueError('learn one action/context/relationship gate and field schema per model')
                identity=canonical(observation['before'])
                if identity in seen:raise ValueError('duplicate input states do not supply independent evidence')
                seen.add(identity)
        if train&held:raise ValueError('held-out input states must be separate')
        coefficients={};ranges={}
        for field in sorted(schema):
            points=[(o['before'][field],o['after'][field]) for o in examples]
            x0,y0=points[0];distinct=next(((x,y) for x,y in points if x!=x0),None)
            if distinct is None:return {'status':'insufficient_variation','field':field,'reason':'Cannot identify a field transition without distinct training values.','model_calls':0}
            x1,y1=distinct;a=Fraction(y1-y0,x1-x0);b=Fraction(y0)-a*x0
            coefficients[field]={'a':[a.numerator,a.denominator],'b':[b.numerator,b.denominator]}
            ranges[field]=[min(x for x,y in points),max(x for x,y in points)]
        model={'version':1,'gate':first_gate,'coefficients':coefficients,'training_range':ranges,'training_count':len(examples),'held_out_count':len(validation),'examples':examples,'validation':validation,'scope':'fieldwise affine hypothesis conditioned on exact labels; finite observations do not establish causality or universal correctness'}
        for role,observations in [('training',examples),('held_out',validation)]:
            for observation in observations:
                try:predicted=self.apply(model,observation['before'])
                except ValueError:predicted=None
                if canonical(predicted)!=canonical(observation['after']):return {'status':'unsupported_pattern' if role=='training' else 'validation_failed','role':role,'model_calls':0}
        raw=canonical(model);ident=hashlib.sha256(raw).hexdigest()
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO contextual_transition_models VALUES (?,?,1)',(ident,raw.decode()))
            for role,observations in [('training',examples),('held_out',validation)]:
                for observation in observations:self.db.execute('INSERT INTO transition_observations(role,payload) VALUES (?,?)',(role,canonical(observation).decode()))
        active=bool(self.db.execute('SELECT active FROM contextual_transition_models WHERE id=?',(ident,)).fetchone()[0])
        return {'status':'hypothesis_saved','model_id':ident,'active':active,'coefficients':coefficients,'training_count':len(examples),'held_out_count':len(validation),'model_calls':0,'scope':model['scope']}
    def get(self,ident):
        row=self.db.execute('SELECT * FROM contextual_transition_models WHERE id=?',(ident,)).fetchone()
        if row is None:raise ValueError('unknown transition model')
        model=json.loads(row['payload'])
        if hashlib.sha256(canonical(model)).hexdigest()!=ident:raise ValueError('corrupt transition evidence')
        return model,bool(row['active'])
    def predict(self,ident,value,action,context,relationships,allow_extrapolation=False):
        if type(allow_extrapolation)is not bool:raise ValueError('boolean extrapolation flag required')
        model,active=self.get(ident)
        if not active:return {'status':'disabled','model_calls':0}
        supplied=gate(action,context,relationships)
        if canonical(supplied)!=canonical(model['gate']):return {'status':'context_mismatch','reason':'Action, context or relationships differ from observed conditions.','model_calls':0}
        result=self.apply(model,value)
        outside=any(not model['training_range'][k][0]<=x<=model['training_range'][k][1] for k,x in value.items())
        if outside and not allow_extrapolation:return {'status':'outside_observed_range','reason':'Extrapolation requires an explicit flag.','model_calls':0}
        inverse=None
        if all(Fraction(*c['a']) for c in model['coefficients'].values()):inverse=self.apply(model,result,reverse=True)==value
        return {'status':'predicted','state':result,'model_id':ident,'extrapolated':outside,'inverse_consistent':inverse,'verified_outcome':False,'model_calls':0,'scope':model['scope']}
    def feedback(self,ident,observation):
        supplied=self.observation(observation);model,active=self.get(ident)
        if canonical(supplied)!=canonical(model['gate']):return {'status':'context_mismatch','active':active,'model_calls':0}
        try:supported=self.apply(model,observation['before'])==observation['after']
        except ValueError:supported=False
        with self.db:
            self.db.execute('INSERT INTO transition_observations(role,payload) VALUES (?,?)',('feedback',canonical(observation).decode()))
            if not supported:self.db.execute('UPDATE contextual_transition_models SET active=0 WHERE id=?',(ident,))
        return {'status':'supported_on_observation' if supported else 'hypothesis_disabled','active':active and supported,'model_calls':0,'observed_match':supported}
