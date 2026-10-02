"""Goal-directed composition of separately learned structured behaviors.

A goal is explicit and replay verifies equality under the learned hypotheses,
not whether an action occurred in the world. No complete training path is needed.
"""
from collections import deque
import hashlib
import json
from pattern_memory import encoded

class BehaviorComposition:
    def __init__(self,engine):
        self.engine,self.db,self.learner=engine,engine.db,engine.behavior
        self.db.execute('''CREATE TABLE IF NOT EXISTS composed_behavior_plans
            (id TEXT PRIMARY KEY, dependencies TEXT NOT NULL, path TEXT NOT NULL,
             digest TEXT NOT NULL)''')

    def solve(self,initial,target,contexts,max_depth=4,max_nodes=128):
        self.learner.state(initial);self.learner.state(target)
        if not isinstance(contexts,list) or not 1<=len(contexts)<=8 or len({encoded(c) for c in contexts})!=len(contexts):
            raise ValueError('1..8 distinct explicit behavior contexts required')
        if any(type(n) is not int for n in (max_depth,max_nodes)) or not 0<=max_depth<=8 or not 1<=max_nodes<=512:
            raise ValueError('invalid composition bounds')
        models=[];rejected=[];limited=False
        for context in contexts:
            if self.db.execute('SELECT 1 FROM behavior_limits WHERE context=?',(encoded(context),)).fetchone():limited=True
            for model in self.learner.inventory(context):
                if len(models)+len(rejected)>=128:return self.report('bounded','model budget exceeded',0,rejected)
                if not model['eligible'] or model['conflicts'] or model['search_limited']:
                    rejected.append({'context':context,'model_id':model['model_id'],'conflicts':model['conflicts'],
                                     'reason':'counterevidence' if model['conflicts'] else 'insufficient_or_bounded_evidence'})
                else:models.append(dict(model,context=context))
        if limited:return self.report('bounded','learner evidence window exceeded',0,rejected)
        dependencies=hashlib.sha256(encoded({'models':models,'rejected':rejected}).encode()).hexdigest()
        key=hashlib.sha256(encoded({'initial':initial,'target':target,'contexts':sorted(contexts,key=encoded)}).encode()).hexdigest()
        available={m['model_id']:m for m in models}
        row=self.db.execute('SELECT * FROM composed_behavior_plans WHERE id=?',(key,)).fetchone()
        path=None;source='bounded_search';expanded=0
        if row and row['dependencies']==dependencies:
            if hashlib.sha256(row['path'].encode()).hexdigest()!=row['digest']:raise ValueError('corrupt composition plan')
            saved=json.loads(row['path'])
            if len(saved)<=max_depth and all(i in available for i in saved):
                path=saved;source='reverified_memory'
        if path is None:
            queue=deque([(dict(initial),[])]);seen={encoded(initial)};depth_limited=False
            while queue:
                if expanded>=max_nodes:return self.report('bounded','node budget exhausted',expanded,rejected)
                state,steps=queue.popleft();expanded+=1
                if encoded(state)==encoded(target):path=steps;break
                if len(steps)>=max_depth:depth_limited=True;continue
                for model in models:
                    following,bounded=self.learner.apply(model['program'],state)
                    if bounded:return self.report('bounded','behavior application exceeded bounds',expanded,rejected)
                    if following is None:continue
                    raw=encoded(following)
                    if raw in seen:continue
                    if len(seen)>=max_nodes:return self.report('bounded','state budget exhausted',expanded,rejected)
                    seen.add(raw);queue.append((following,steps+[model['model_id']]))
            if path is None:
                status='bounded' if depth_limited else 'contested' if any(r['conflicts'] for r in rejected) else 'knowledge_gap' if not models else 'unsolved'
                return self.report(status,'no verified path under eligible evidence and supplied bounds',expanded,rejected)
        # Replay each learned operation rather than trusting the search's output.
        state=dict(initial);trace=[]
        for ident in path:
            model=available[ident];following,bounded=self.learner.apply(model['program'],state)
            if following is None or bounded:return self.report('invalidated','plan failed replay',expanded,rejected)
            trace.append({'model_id':ident,'context':model['context'],'before':state,'after':following,'support':model['support']})
            state=following
        if encoded(state)!=encoded(target):return self.report('invalidated','replayed target mismatch',expanded,rejected)
        raw=encoded(path)
        with self.db:self.db.execute('INSERT OR REPLACE INTO composed_behavior_plans VALUES (?,?,?,?)',
                                     (key,dependencies,raw,hashlib.sha256(raw.encode()).hexdigest()))
        return {**self.report('goal_satisfied','exact target matched under replayed learned hypotheses',expanded,rejected),
                'result':state,'plan':trace,'source':source,'goal_satisfied':True,'verification_scope':'explicit structured goal under learned models, not world execution'}

    @staticmethod
    def report(status,reason,expanded,rejected):
        return {'status':status,'reason':reason,'expanded':expanded,'rejected_models':rejected,'model_calls':0,'verified_world_outcome':False}
