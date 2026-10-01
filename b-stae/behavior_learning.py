"""Small hypothesis learner over installed operations, with held-out validation.

Evidence supports a hypothesis, never a guarantee over all future inputs.
No generated code, unrestricted rule invention, neural training or model calls.
"""
import hashlib
import json
from behavior_library import typed
from representation import canonical

class BehaviorLearning:
    def __init__(self,library):
        self.library,self.db=library,library.db
        self.db.execute('CREATE TABLE IF NOT EXISTS behavior_hypotheses (id TEXT PRIMARY KEY, payload TEXT NOT NULL, digest TEXT NOT NULL, active INTEGER NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS hypothesis_feedback (id INTEGER PRIMARY KEY, hypothesis_id TEXT NOT NULL, evidence TEXT NOT NULL, supported INTEGER NOT NULL)')
    def pairs(self,examples):
        if not isinstance(examples,list) or not 1<=len(examples)<=16:raise ValueError('1..16 example pairs required')
        seen=set()
        for pair in examples:
            if not isinstance(pair,dict) or set(pair)!={'input','output'}:raise ValueError('input/output pair required')
            typed(pair['input']);typed(pair['output'])
            key=canonical(pair['input'])
            if key in seen:raise ValueError('distinct example inputs required')
            seen.add(key)
        return seen
    def fits(self,action,examples):
        for pair in examples:
            try:out,_=self.library.apply(pair['input'],action)
            except (ValueError,OverflowError,KeyError):return False
            if canonical(out)!=canonical(pair['output']):return False
        return True
    def learn(self,examples,validation,source):
        train=self.pairs(examples);test=self.pairs(validation)
        if len(train)<3 or train&test:raise ValueError('at least three training inputs and separate held-out inputs required')
        if not isinstance(source,str) or not 1<=len(source)<=256:raise ValueError('bounded evidence source required')
        first=examples[0];entry,result=first['input'],first['output'];kind,_=typed(entry)
        candidates=[]
        if kind=='int64' and type(result)is int:
            candidates.append({'operation':'add','amount':result-entry})
            for pair in examples:
                x,y=pair['input'],pair['output']
                if type(x)is int and type(y)is int and x and y%x==0:
                    candidates.append({'operation':'multiply','amount':y//x});break
        if kind=='utf8' and isinstance(result,str):
            candidates.extend({'operation':op} for op in ('uppercase','lowercase','trim'))
            if result.startswith(entry):candidates.append({'operation':'append','text':result[len(entry):]})
        if kind=='integer_series':candidates.extend({'operation':op} for op in ('sort_ascending','sort_descending','series_sum','series_count'))
        candidates=list({canonical(a):a for a in candidates}.values())
        matching=[a for a in candidates if self.fits(a,examples)]
        if not matching:return {'status':'unsupported_pattern','reason':'No installed hypothesis template fits the training data.','model_calls':0}
        if len(matching)!=1:return {'status':'ambiguous','candidates':matching,'reason':'Training examples do not distinguish supported hypotheses.','model_calls':0}
        action=matching[0]
        if not self.fits(action,validation):return {'status':'validation_failed','hypothesis':action,'reason':'Held-out evidence contradicts the hypothesis.','model_calls':0}
        payload={'version':1,'action':action,'input_type':kind,'examples':examples,'validation':validation,'source':source,'library':self.library.fingerprint(),'scope':'finite example support; every future execution requires goal verification'}
        raw=canonical(payload);ident=hashlib.sha256(raw).hexdigest()
        # Repeating evidence never reactivates a hypothesis rejected by feedback.
        with self.db:self.db.execute('INSERT OR IGNORE INTO behavior_hypotheses VALUES (?,?,?,1)',(ident,raw.decode(),ident))
        active=bool(self.db.execute('SELECT active FROM behavior_hypotheses WHERE id=?',(ident,)).fetchone()[0])
        return {'status':'hypothesis_saved','active':active,'hypothesis_id':ident,'hypothesis':action,'training_count':len(examples),'held_out_count':len(validation),'model_calls':0,'scope':payload['scope']}
    def inventory(self):
        records=[]
        for row in self.db.execute('SELECT * FROM behavior_hypotheses ORDER BY id LIMIT 65'):
            if len(records)>=64:raise ValueError('hypothesis inventory budget exceeded')
            payload=json.loads(row['payload'])
            if hashlib.sha256(canonical(payload)).hexdigest()!=row['digest'] or row['digest']!=row['id']:raise ValueError('corrupt hypothesis evidence')
            records.append(dict(payload,hypothesis_id=row['id'],active=bool(row['active'])))
        return records
    def candidates(self):
        current=self.library.fingerprint()
        return [h['action'] for h in self.inventory() if h['active'] and h['library']==current]
    def feedback(self,ident,pair):
        self.pairs([pair])
        hypothesis=next((h for h in self.inventory() if h['hypothesis_id']==ident),None)
        if hypothesis is None:raise ValueError('unknown hypothesis')
        supported=self.fits(hypothesis['action'],[pair])
        with self.db:
            self.db.execute('INSERT INTO hypothesis_feedback(hypothesis_id,evidence,supported) VALUES (?,?,?)',(ident,canonical(pair).decode(),int(supported)))
            if not supported:self.db.execute('UPDATE behavior_hypotheses SET active=0 WHERE id=?',(ident,))
        return {'status':'supported_on_example' if supported else 'hypothesis_disabled','active':hypothesis['active'] and supported,'model_calls':0}
