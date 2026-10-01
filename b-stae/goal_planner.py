"""Bounded goal-directed search across installed verified behaviors; no LLM.

Goal predicates are explicit contracts, not open-ended natural-language meaning.
Search is breadth-first over canonical typed states with depth/node/frontier limits.
"""
from collections import Counter, deque
import hashlib
import json
from behavior_library import typed
from representation import canonical

PREDICATES={'sorted_ascending','sorted_descending','trimmed','uppercase','lowercase','sum_of_input','count_of_input'}

class GoalPlanner:
    def __init__(self,tasks):
        self.tasks,self.db,self.library=tasks,tasks.db,tasks.behaviors
        self.db.execute('CREATE TABLE IF NOT EXISTS goal_plans (id TEXT PRIMARY KEY, actions TEXT NOT NULL, digest TEXT NOT NULL, uses INTEGER NOT NULL)')
    def validate_goal(self,goal):
        if not isinstance(goal,dict) or len(goal)!=1:raise ValueError('one explicit goal contract required')
        if 'equals' in goal:typed(goal['equals']);return
        predicates=goal.get('all')
        if not isinstance(predicates,list) or not 1<=len(predicates)<=8 or any(not isinstance(p,str) or p not in PREDICATES for p in predicates) or len(set(predicates))!=len(predicates):raise ValueError('supported unique goal predicates required')
        if {'uppercase','lowercase'}<=set(predicates) or {'sorted_ascending','sorted_descending'}<=set(predicates):raise ValueError('conflicting goal properties require clarification')
    def verify(self,entry,result,goal):
        self.validate_goal(goal)
        if 'equals' in goal:return canonical(result)==canonical(goal['equals'])
        kind,_=typed(entry);checks=[]
        predicates=goal['all']
        for predicate in predicates:
            if predicate.startswith('sorted_'):
                reverse=predicate=='sorted_descending'
                valid=kind=='integer_series' and isinstance(result,list) and Counter(entry)==Counter(result) and all((a>=b if reverse else a<=b) for a,b in zip(result,result[1:]))
            elif predicate in ('trimmed','uppercase','lowercase'):
                # Preserve input content under only the explicitly requested transforms.
                reference=entry
                if kind!='utf8':checks.append(False);continue
                if 'trimmed' in predicates:reference=reference.strip()
                if 'uppercase' in predicates:reference=reference.upper()
                if 'lowercase' in predicates:reference=reference.lower()
                valid=isinstance(result,str) and result==reference
            elif predicate=='sum_of_input':valid=kind=='integer_series' and type(result)is int and result==sum(entry)
            else:valid=kind in ('integer_series','utf8') and type(result)is int and result==len(entry)
            checks.append(valid)
        return all(checks)
    def candidates(self,supplied):
        base=[{'operation':p} for p in ('trim','uppercase','lowercase','text_length','sort_ascending','sort_descending','series_sum','series_count')]
        if supplied is not None:
            if not isinstance(supplied,list) or len(supplied)>16:raise ValueError('at most 16 explicit candidate operations allowed')
            for action in supplied:
                if not isinstance(action,dict):raise ValueError('candidate action must be structured')
                # Apply validates full parameters against each state; reject unknown IDs here.
                if action.get('operation') not in {s['id'] for s in self.library.inventory()}|{'add','append','brighten','translate','sample_shift'}:raise ValueError('unregistered candidate operation')
                base.append(action)
        unique={canonical(action):action for action in base}
        return [unique[k] for k in sorted(unique)]
    def execute(self,value,goal,candidates=None,max_depth=4,max_nodes=128,max_frontier=128):
        if any(type(n)is not int for n in (max_depth,max_nodes,max_frontier)) or not 0<=max_depth<=8 or not 1<=max_nodes<=512 or not 1<=max_frontier<=512:raise ValueError('invalid goal search bounds')
        value=self.tasks.input(value);self.validate_goal(goal);actions=self.candidates(candidates)
        key=hashlib.sha256(canonical({'version':1,'value':value,'goal':goal,'candidates':actions,'library':self.library.fingerprint()})).hexdigest()
        row=self.db.execute('SELECT * FROM goal_plans WHERE id=?',(key,)).fetchone()
        found=None;source='bounded_search';expanded=0
        if row:
            raw=row['actions'].encode()
            if hashlib.sha256(raw).hexdigest()!=row['digest']:raise ValueError('corrupt goal plan')
            saved=json.loads(raw)
            if len(saved)<=max_depth:
                observed=value
                for action in saved:observed,_=self.library.apply(observed,action)
                if self.verify(value,observed,goal):found=saved;source='reverified_memory'
        if found is None:
            queue=deque([(value,[])]);seen={canonical(value)};depth_limited=False
            while queue:
                if expanded>=max_nodes:return {'status':'bounded','reason':'node budget exhausted','expanded':expanded,'model_calls':0}
                state,path=queue.popleft();expanded+=1
                if self.verify(value,state,goal):found=path;break
                if len(path)>=max_depth:depth_limited=True;continue
                for action in actions:
                    try:following,_=self.library.apply(state,action)
                    except (ValueError,OverflowError,KeyError):continue
                    raw=canonical(following)
                    if raw in seen:continue
                    if len(seen)>=max_nodes or len(queue)>=max_frontier:return {'status':'bounded','reason':'state/frontier budget exhausted','expanded':expanded,'model_calls':0}
                    seen.add(raw);queue.append((following,path+[action]))
            if found is None:return {'status':'bounded' if depth_limited else 'unsolved','reason':'No verified plan within the supplied behaviors and bounds; this is not proof of impossibility.','expanded':expanded,'model_calls':0}
        # Independently execute the chosen plan and recheck the whole goal.
        result=value;trace=[]
        for action in found:
            result,check=self.library.apply(result,action);trace.append(dict(check,action=action))
        if not self.verify(value,result,goal):raise ValueError('executed goal verification failed')
        raw=canonical(found)
        with self.db:self.db.execute('INSERT INTO goal_plans VALUES (?,?,?,1) ON CONFLICT(id) DO UPDATE SET uses=uses+1',(key,raw.decode(),hashlib.sha256(raw).hexdigest()))
        return {'status':'fulfilled','result':result,'goal':goal,'plan':found,'execution':trace,'verified':True,'source':source,'expanded':expanded,'model_calls':0,'verification_scope':'explicit goal properties and installed behavior contracts; no learned or universal intelligence claim'}
