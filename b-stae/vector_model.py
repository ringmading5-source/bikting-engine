"""Structured vector dynamics research model; no language understanding claim.

One affine operator per (relation, behavior), conditioned on numeric context.
Ridge least squares learns forward and backward operators from observations.
"""
import json
import math


def vector(value, size=None):
    if not isinstance(value, list) or not value or len(value)>64 or any(type(x) not in (int,float) or not math.isfinite(x) for x in value):
        raise ValueError('finite numeric vector of 1 to 64 dimensions required')
    if size is not None and len(value)!=size:raise ValueError('vector dimension mismatch')
    return value


def route(code, step, state, duration_ms=1000):
    if not isinstance(code,str) or len(code)!=3 or set(code)-{'0','1'}:raise ValueError('3-bit output code required')
    return {'step':step,'start_ms':step*duration_ms,'duration_ms':duration_ms,
            'output_code':code,'channels':[name for bit,name in zip(code,('visual','voice','text')) if bit=='1'],
            'state':state,'status':'predicted','rendering':'adapter_required'}


class VectorModel:
    def __init__(self, db):
        self.db=db
        db.execute('CREATE TABLE IF NOT EXISTS vector_models (name TEXT PRIMARY KEY, checkpoint TEXT NOT NULL)')
        db.execute('CREATE TABLE IF NOT EXISTS vector_feedback (id INTEGER PRIMARY KEY, model TEXT NOT NULL, record TEXT NOT NULL)')
        db.execute('CREATE TABLE IF NOT EXISTS vector_observations (id INTEGER PRIMARY KEY, model TEXT NOT NULL, split TEXT NOT NULL, record TEXT NOT NULL)')

    def train(self,name,training,validation,ridge=1e-8):
        import numpy as np
        if not isinstance(name,str) or not 1<=len(name)<=100:raise ValueError('model name required')
        if not isinstance(training,list) or not 3<=len(training)<=10000 or not isinstance(validation,list) or not 1<=len(validation)<=10000:raise ValueError('bounded training and held-out validation required')
        if type(ridge) not in (int,float) or not math.isfinite(ridge) or ridge<=0:raise ValueError('positive finite ridge required')
        d=len(vector(training[0]['before']));c=len(vector(training[0]['context']))
        groups={};seen=set()
        def validate(r):
            if not isinstance(r,dict) or set(r)!={'before','after','relation','behavior','context','provenance'}:raise ValueError('complete transition record required')
            vector(r['before'],d);vector(r['after'],d);vector(r['context'],c)
            for field in ('relation','behavior','provenance'):
                if not isinstance(r[field],str) or not 1<=len(r[field])<=500:raise ValueError('typed labels and provenance required')
            return (r['relation'],r['behavior'])
        def identity(r):return json.dumps([r['before'],r['relation'],r['behavior'],r['context']],sort_keys=True)
        for r in training:
            key=validate(r);groups.setdefault(key,[]).append(r);seen.add(identity(r))
        for r in validation:
            validate(r)
            if identity(r) in seen:raise ValueError('validation input leakage')
        operators=[]
        for (relation,behavior),rows in sorted(groups.items()):
            x=np.array([[1]+r['before']+r['context'] for r in rows],dtype=float)
            y=np.array([r['after'] for r in rows],dtype=float)
            z=np.array([[1]+r['after']+r['context'] for r in rows],dtype=float)
            forward=np.linalg.solve(x.T@x+ridge*np.eye(x.shape[1]),x.T@y)
            backward=np.linalg.solve(z.T@z+ridge*np.eye(z.shape[1]),z.T@np.array([r['before'] for r in rows]))
            operators.append({'relation':relation,'behavior':behavior,'forward':forward.tolist(),'backward':backward.tolist(),
                'count':len(rows),'rank':int(np.linalg.matrix_rank(x)), 'features':x.shape[1],
                'min':np.min(x[:,1:],axis=0).tolist(),'max':np.max(x[:,1:],axis=0).tolist(),
                'train_mse':float(np.mean((x@forward-y)**2))})
        checkpoint={'version':1,'state_dim':d,'context_dim':c,'operators':operators,'training_count':len(training)}
        errors=[];nearest=[];backward_errors=[]
        for r in validation:
            op=next((o for o in operators if (o['relation'],o['behavior'])==validate(r)),None)
            if op is None:raise ValueError('validation behavior absent in training')
            predicted=np.array([1]+r['before']+r['context'])@np.array(op['forward'])
            errors.append(float(np.mean((predicted-np.array(r['after']))**2)))
            recovered=np.array([1]+r['after']+r['context'])@np.array(op['backward'])
            backward_errors.append(float(np.mean((recovered-np.array(r['before']))**2)))
            rows=groups[validate(r)]
            neighbor=min(rows,key=lambda q:sum((a-b)**2 for a,b in zip(q['before']+q['context'],r['before']+r['context'])))
            nearest.append(sum((a-b)**2 for a,b in zip(neighbor['after'],r['after']))/d)
        checkpoint['evaluation']={'validation_count':len(validation),'forward_mse':sum(errors)/len(errors),
            'backward_mse':sum(backward_errors)/len(backward_errors),'nearest_neighbor_mse':sum(nearest)/len(nearest),
            'exact_lookup_coverage':0.0,'affine_baseline':'identical to this learner; no architectural advantage established',
            'confidence':'not calibrated'}
        with self.db:
            self.db.execute('INSERT OR REPLACE INTO vector_models VALUES (?,?)',(name,json.dumps(checkpoint,allow_nan=False)))
            for split,rows in [('training',training),('validation',validation)]:
                self.db.executemany('INSERT INTO vector_observations(model,split,record) VALUES (?,?,?)',[(name,split,json.dumps(r,allow_nan=False)) for r in rows])
        return checkpoint

    def load(self,name):
        row=self.db.execute('SELECT checkpoint FROM vector_models WHERE name=?',(name,)).fetchone()
        if row is None:raise ValueError('unknown vector model')
        return json.loads(row[0])

    def predict(self,name,state,relation,behavior,context):
        model=self.load(name);vector(state,model['state_dim']);vector(context,model['context_dim'])
        op=next((x for x in model['operators'] if x['relation']==relation and x['behavior']==behavior),None)
        if op is None:return {'status':'unknown','reason':'untrained relation or behavior'}
        if op['rank']<op['features']:return {'status':'unsupported','reason':'training design is rank deficient'}
        features=state+context
        if any(v<a-1e-9 or v>b+1e-9 for v,a,b in zip(features,op['min'],op['max'])):return {'status':'unsupported','reason':'outside training feature ranges'}
        def apply(values,weights):return [sum(v*row[j] for v,row in zip([1]+values,weights)) for j in range(model['state_dim'])]
        after=apply(features,op['forward']);back=apply(after+context,op['backward'])
        if any(not math.isfinite(v) for v in after+back):raise ValueError('nonfinite model prediction')
        return {'status':'predicted','state':after,'backward_error':sum((a-b)**2 for a,b in zip(state,back))/len(state),
                'evidence_count':op['count'],'confidence':None,'verified':False}

    def plan(self,name,state,goal,actions,max_depth=5,max_expansions=1000,tolerance=1e-5,output_code='111'):
        model=self.load(name);vector(state,model['state_dim']);vector(goal,model['state_dim']);route(output_code,0,state)
        if type(max_depth) is not int or not 0<=max_depth<=20 or type(max_expansions) is not int or not 1<=max_expansions<=10000:raise ValueError('invalid search budget')
        if type(tolerance) not in (int,float) or not math.isfinite(tolerance) or tolerance<=0:raise ValueError('positive tolerance required')
        if not isinstance(actions,list) or not 1<=len(actions)<=32:raise ValueError('bounded action contracts required')
        for a in actions:
            if not isinstance(a,dict) or set(a)!={'relation','behavior','context','min','max'}:raise ValueError('numeric action contract required')
            vector(a['context'],model['context_dim']);vector(a['min'],model['state_dim']);vector(a['max'],model['state_dim'])
            if any(lo>hi for lo,hi in zip(a['min'],a['max'])):raise ValueError('invalid contract bounds')
        gap=lambda s:sum((a-b)**2 for a,b in zip(s,goal))
        frontier=[(state,[])];visited=set();expanded=0
        for depth in range(max_depth+1):
            next_frontier=[]
            for current,path in sorted(frontier,key=lambda item:gap(item[0])):
                if gap(current)<=tolerance*tolerance:return {'status':'predicted_goal','verified':False,'state':current,'path':path,'timeline':[route(output_code,i,p['state']) for i,p in enumerate(path)],'expansions':expanded}
                if depth==max_depth:continue
                key=tuple(round(x,6) for x in current)
                if key in visited:continue
                visited.add(key)
                for a in actions:
                    if expanded>=max_expansions:return {'status':'budget','verified':False,'expansions':expanded}
                    if any(v<lo or v>hi for v,lo,hi in zip(current,a['min'],a['max'])):continue
                    expanded+=1;result=self.predict(name,current,a['relation'],a['behavior'],a['context'])
                    if result['status']=='predicted':next_frontier.append((result['state'],path+[dict(result,action=a)]))
            frontier=next_frontier
            if not frontier:break
        return {'status':'unresolved','verified':False,'expansions':expanded}

    def verify(self,name,state,action,observed,tolerance=1e-5):
        if type(tolerance) not in (int,float) or not math.isfinite(tolerance) or tolerance<=0:raise ValueError('positive tolerance required')
        result=self.predict(name,state,action['relation'],action['behavior'],action['context'])
        vector(observed,self.load(name)['state_dim'])
        if result['status']!='predicted':return result
        error=sum((a-b)**2 for a,b in zip(result['state'],observed))**0.5
        record={'status':'verified' if error<=tolerance else 'corrected','before':state,'action':action,'predicted_state':result['state'],'observed_state':observed,'error':error,'provenance':'caller_supplied_observation'}
        with self.db:self.db.execute('INSERT INTO vector_feedback(model,record) VALUES (?,?)',(name,json.dumps(record,allow_nan=False)))
        return record
