"""Synthetic field-alignment transfer, not a demonstration of physical analogy."""
import json
from engine import Engine
from behavior_composition_demo import train,state

DOMAINS=[('buffer',('buffer_id','stage','amount')),('queue',('job_id','stage','work')),('stock',('product_id','stage','quantity'))]

def align(e,fields):
    entity,phase,value=fields
    pairs=[{'domain':{entity:name,phase:step,value:x},'canonical':state(name,step,x)}
           for name,step,x in [('sampleA','start',40),('sampleB','middle',60),('sampleC','end',90)]]
    return e.transfer.learn(pairs,{'simulation':True,'unit_system':'abstract'},['scale','offset'],'synthetic:aligned-states')['adapter']

def run():
    e=Engine(database=':memory:')
    try:
        train(e);checks=[]
        for domain,fields in DOMAINS:
            adapter=align(e,fields);entity,phase,value=fields
            for i in range(100):
                initial={entity:f'unseen_{domain}_{i}',phase:'start',value:100+i}
                target={entity:initial[entity],phase:'end',value:2*(105+i)}
                r=e.transfer.solve(initial,target,adapter,{'simulation':True,'unit_system':'abstract'})
                checks.append(r['status']=='goal_satisfied' and r['result']==target)
        unknown=e.transfer.solve(initial,target,adapter,{})
        incompatible=e.transfer.solve(initial,target,adapter,{'simulation':False,'unit_system':'abstract'})
        before=state('new','start',100)
        feedback=e.transfer.feedback(adapter,{'domain':initial,'canonical':dict(before,value=999)},'synthetic:alignment-counterexample')
        rejected=e.transfer.solve(initial,target,adapter,{'simulation':True,'unit_system':'abstract'})
        return {'correct':sum(checks),'total':len(checks),'domains':3,'behavior_training_pairs':6,'alignment_pairs':9,
                'missing_conditions':unknown,'incompatible_conditions':incompatible,'feedback':feedback,'after_feedback':rejected,
                'scope':'Copy bindings from supplied aligned examples and explicit conditions; no inferred causal equivalence or physical-world understanding.'}
    finally:e.close()

if __name__=='__main__':print(json.dumps(run(),indent=2))
