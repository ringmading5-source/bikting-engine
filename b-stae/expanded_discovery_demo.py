"""Independent synthetic oracles score expanded discovery on withheld inputs."""
import json
from engine import Engine

def evaluate():
    cases=[]
    tasks={
        'stride_two':lambda x:x[::2], 'stride_three':lambda x:x[::3],
        'stride_four':lambda x:x[::4], 'drop_three':lambda x:x[3:],
        'three_parts':lambda x:x[:1]+x[-1:]+x[1:-1],
        'shift':lambda x:[v+7 for v in x], 'scale':lambda x:[v*3 for v in x],
        'affine':lambda x:[2*v-5 for v in x], 'square':lambda x:[v*v for v in x],
        'quadratic':lambda x:[2*v*v-3*v+4 for v in x], 'fraction':lambda x:[v/2 for v in x]}
    for name, oracle in tasks.items():
        engine=Engine(database=':memory:')
        try:
            for index,units in enumerate(([1,3,5,7,9],[-2,4,6,8,10,12,14],[0,2,6,8,11,13,15,17,19,21])):
                engine.patterns.learn_pair(units,oracle(units),'numeric','synthetic:'+str(index))
            search=engine.discovery_patterns.discover('numeric',max_parts=3 if name=='three_parts' else 2,max_programs=4096)
            for length in (6,8,9):
                units=list(range(30,30+length)); prediction=engine.discovery_patterns.predict(units,'numeric')
                candidates=prediction['candidates']; expected=oracle(units)
                cases.append({'task':name,'input':units,'expected':expected,
                              'top_correct':bool(candidates) and candidates[0]['units']==expected,
                              'correct_candidate_present':any(c['units']==expected for c in candidates),
                              'status':prediction['status'],'candidate_count':len(candidates),
                              'search_limited':search['search_limited']})
        finally:engine.close()
    return {'cases':cases,'total':len(cases),'top_correct':sum(c['top_correct'] for c in cases),
            'correct_candidate_present':sum(c['correct_candidate_present'] for c in cases),
            'model_calls':0,'scope':'Synthetic tests within a programmed sequence/polynomial hypothesis language.'}

if __name__=='__main__':print(json.dumps(evaluate(),indent=2))
