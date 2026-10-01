"""Disjoint training/test benchmark. Oracles only generate data and score outputs."""
import json
from engine import Engine

def evaluate():
    cases=[]
    # These task names/functions are never passed to the discovery algorithm.
    oracles={'reverse':lambda x:x[::-1], 'duplicate':lambda x:x+x,
             'drop_first':lambda x:x[1:], 'append_first':lambda x:x+x[:1],
             'rotate':lambda x:x[1:]+x[:1], 'insert':lambda x:x+['!']}
    for name, oracle in oracles.items():
        engine=Engine(database=':memory:')
        try:
            for index,text in enumerate(('ab','cde','fghij')):
                units=list(text)
                engine.patterns.learn_pair(units,oracle(units),'character',f'synthetic:train:{index}')
            report=engine.discovery_patterns.discover('character')
            for text in ('klmn','opqrst','uvwxyza'):
                result=engine.discovery_patterns.predict(list(text),'character')
                cases.append({'task':name,'input':text,'expected':oracle(list(text)),
                              'top_candidate':result['candidates'][0]['units'] if result['candidates'] else None,
                              'top_correct':bool(result['candidates']) and result['candidates'][0]['units']==oracle(list(text)),
                              'candidate_count':len(result['candidates']), 'status':result['status'],
                              'search_limited':report['search_limited']})
        finally:engine.close()
    return {'cases':cases,'top_correct':sum(c['top_correct'] for c in cases),'total':len(cases),
            'model_calls':0,'scope':'Synthetic sequences; predefined slice/literal language, learned programs; no language semantics.'}

if __name__=='__main__':print(json.dumps(evaluate(),indent=2))
