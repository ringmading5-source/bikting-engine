"""Controlled scan vs first/last/count retrieval; identical interior verifier."""
import json
import statistics
import time
from engine import Engine
from composed_state_demo import PLURAL


def text_for(i):
    return chr(65+i%26)+f'{i:05d}'+('x'*(i%11))+chr(65+(i//26)%26)


def run(size,repeats=10):
    e=Engine(database=':memory:')
    try:
        for i in range(size):
            text=text_for(i);e.boundary_states.observe(list(map(ord,text)),{'text':text},'synthetic','benchmark')
        for text in ('cat','cot'):e.boundary_states.observe(list(map(ord,text)),{'text':text},'collision','benchmark')
        queries=[text_for(0),text_for(size//2),text_for(size-1),'cat','cut','unseen']
        totals={};results={};before=e.db.total_changes
        for strategy in ('scan','indexed'):
            elapsed=[];candidates=nodes=0
            for repeat in range(repeats):
                start=time.perf_counter();batch=[]
                for text in queries:
                    r=e.boundary_states.search(list(map(ord,text)),'benchmark',strategy=strategy)
                    batch.append({'query':text,'matches':[x['payload'] for x in r['matches']],'status':r['status']})
                    if repeat==0:candidates+=r['tested_states'];nodes+=r['recursive_nodes_visited']
                elapsed.append((time.perf_counter()-start)*1000/len(queries))
                results[strategy]=batch
            totals[strategy]={'median_ms_per_query':statistics.median(elapsed),'tested_states_per_query_set':candidates,
                              'recursive_nodes_per_query_set':nodes}
        assert results['scan']==results['indexed'];assert before==e.db.total_changes
        return {'stored_states':size+2,'query_count':len(queries),'timing_repeats':repeats,'strategies':totals,
                'same_answers':True,'collision_check':results['indexed'][4],'queries':results['indexed'],'inference_writes':0}
    finally:e.close()


def evaluate():
    e=Engine(database=':memory:')
    try:
        e.composed_states.learn(PLURAL,'plural')
        checks=[]
        for text in ('cat','rabbit','cot'):
            scan=e.composed_states.predict(text,'plural',strategy='scan')
            indexed=e.composed_states.predict(text,'plural',strategy='indexed')
            checks.append({'input':text,'same_outputs':{x['text'] for x in scan['candidates']}=={x['text'] for x in indexed['candidates']},
                           'scan':scan['retrieval'],'indexed':indexed['retrieval']})
        return {'runs':[run(size) for size in (36,180,600,1800)],'transformation_checks':checks,
                'scope':'Exact state retrieval and compatibility with existing predictions; not improved semantic accuracy or a general reasoning benchmark.',
                'limits':['Synthetic signatures are deliberately varied; all-collision buckets can remove the indexing advantage.',
                          'Median of ten six-query batches on an in-memory SQLite database; total application latency is not measured.',
                          'Transformation rules and their full support/conflict inventory are still inspected separately.'],
                'model_calls':0}
    finally:e.close()
if __name__=='__main__':print(json.dumps(evaluate(),indent=2))
