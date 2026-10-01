"""Exact coupled affine fitting: every output field may use all input fields."""
from fractions import Fraction
import hashlib
from representation import canonical
from transition_learning import TransitionLearning,state

class Underdetermined(ValueError):pass
class Inconsistent(ValueError):pass


def solve(matrix,targets):
    """Unique solution of a bounded overdetermined rational linear system."""
    if not matrix or len(matrix)!=len(targets) or not 1<=len(matrix[0])<=17 or len(matrix)>32:raise ValueError('bounded linear system required')
    n=len(matrix[0])
    if any(len(row)!=n for row in matrix):raise ValueError('invalid matrix dimensions')
    rows=[[Fraction(x) for x in row]+[Fraction(y)] for row,y in zip(matrix,targets)]
    pivots=[];rank=0
    for col in range(n):
        pivot=next((i for i in range(rank,len(rows)) if rows[i][col]),None)
        if pivot is None:continue
        rows[rank],rows[pivot]=rows[pivot],rows[rank]
        scale=rows[rank][col];rows[rank]=[x/scale for x in rows[rank]]
        for i in range(len(rows)):
            if i==rank or not rows[i][col]:continue
            scale=rows[i][col];rows[i]=[a-scale*b for a,b in zip(rows[i],rows[rank])]
        pivots.append(col);rank+=1
        if rank==len(rows):break
    if any(not any(row[:n]) and row[n] for row in rows):raise Inconsistent('observations contradict an affine model')
    if rank<n:raise Underdetermined('independent input variation is insufficient')
    result=[Fraction(0)]*n
    for row,col in enumerate(pivots):result[col]=rows[row][n]
    return result


class CoupledTransitionLearning(TransitionLearning):
    def apply(self,model,value,reverse=False):
        if model.get('model_class')!='coupled_affine':return super().apply(model,value,reverse)
        state(value);fields=sorted(model['coefficients'])
        if set(value)!=set(fields):raise ValueError('model field schema mismatch')
        if reverse:
            matrix=[[Fraction(*model['coefficients'][field]['weights'][k]) for k in fields] for field in fields]
            target=[Fraction(value[field])-Fraction(*model['coefficients'][field]['b']) for field in fields]
            outputs=solve(matrix,target)
        else:
            outputs=[sum(Fraction(*model['coefficients'][field]['weights'][k])*value[k] for k in fields)+Fraction(*model['coefficients'][field]['b']) for field in fields]
        if any(y.denominator!=1 or not -(2**63)<=y.numerator<2**63 for y in outputs):raise ValueError('predicted state violates int64 representation')
        return dict(zip(fields,[y.numerator for y in outputs]))
    def inverse_consistency(self,model,value,result):
        if model.get('model_class')!='coupled_affine':return super().inverse_consistency(model,value,result)
        try:return self.apply(model,result,reverse=True)==value
        except Underdetermined:return None
    def learn(self,examples,validation):
        if not isinstance(examples,list) or not 3<=len(examples)<=32 or not isinstance(validation,list) or not 1<=len(validation)<=16:raise ValueError('3..32 training and 1..16 held-out observations required')
        first_gate=self.observation(examples[0]);fields=sorted(examples[0]['before']);train=set();held=set()
        for observations,seen in [(examples,train),(validation,held)]:
            for observation in observations:
                if canonical(self.observation(observation))!=canonical(first_gate) or sorted(observation['before'])!=fields:raise ValueError('one explicit context/action/relationship gate and schema required')
                key=canonical(observation['before'])
                if key in seen:raise ValueError('distinct input observations required')
                seen.add(key)
        if train&held:raise ValueError('held-out inputs must be separate')
        matrix=[[o['before'][k] for k in fields]+[1] for o in examples]
        coefficients={}
        try:
            for field in fields:
                weights=solve(matrix,[o['after'][field] for o in examples])
                coefficients[field]={'weights':{k:[w.numerator,w.denominator] for k,w in zip(fields,weights[:-1])},'b':[weights[-1].numerator,weights[-1].denominator]}
        except Underdetermined:return {'status':'insufficient_variation','reason':'Training design does not identify unique coupled coefficients.','model_calls':0}
        except Inconsistent:return {'status':'unsupported_pattern','reason':'An exact coupled affine model cannot fit all training observations.','model_calls':0}
        ranges={k:[min(o['before'][k] for o in examples),max(o['before'][k] for o in examples)] for k in fields}
        model={'version':1,'model_class':'coupled_affine','gate':first_gate,'coefficients':coefficients,'training_range':ranges,'training_count':len(examples),'held_out_count':len(validation),'examples':examples,'validation':validation,'scope':'coupled affine hypothesis under exact supplied conditions; observational fit does not prove causality or universal correctness'}
        for observations in (examples,validation):
            for observation in observations:
                try:predicted=self.apply(model,observation['before'])
                except ValueError:predicted=None
                if canonical(predicted)!=canonical(observation['after']):return {'status':'validation_failed','model_calls':0}
        raw=canonical(model);ident=hashlib.sha256(raw).hexdigest()
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO contextual_transition_models VALUES (?,?,1)',(ident,raw.decode()))
            for role,observations in [('training',examples),('held_out',validation)]:
                for observation in observations:self.db.execute('INSERT INTO transition_observations(role,payload) VALUES (?,?)',(role,canonical(observation).decode()))
        return {'status':'hypothesis_saved','model_id':ident,'active':bool(self.db.execute('SELECT active FROM contextual_transition_models WHERE id=?',(ident,)).fetchone()[0]),'coefficients':coefficients,'training_count':len(examples),'held_out_count':len(validation),'model_calls':0,'scope':model['scope']}
