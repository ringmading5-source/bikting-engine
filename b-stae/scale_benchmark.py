"""Synthetic scaling benchmark with separate lexical/structural/conflict checks."""
import argparse
import json
import os
import random
import sqlite3
import tempfile
import time
import tracemalloc
from engine import Engine
from expanded_text_training import FRAMES


def vocab(prefix,n):
    # IDs embedded in artificial words make this an explicit synthetic benchmark.
    return [prefix+str(i) for i in range(n)]


def benchmark(per_frame,lexical_tests=30):
    with tempfile.TemporaryDirectory() as folder:
        path=os.path.join(folder,'memory.sqlite3');engine=Engine(database=path)
        try:
            tracemalloc.start();start=time.perf_counter();training=[]
            for context,frame,left,right in FRAMES:
                examples=[{'text':frame.format(a=a,b=b),'record':{left:a,right:b}}
                          for a,b in zip(vocab('person',per_frame),vocab('object',per_frame))]
                training.extend(x['text'] for x in examples)
                # Equal-sized batches avoid exceeding the learner's 32-example bound.
                batches=(per_frame+31)//32
                for i in range(batches):
                    batch=examples[i*per_frame//batches:(i+1)*per_frame//batches]
                    assert engine.meaning_memory.learn_expressions(batch,context)['status']=='learned'
            training_seconds=time.perf_counter()-start
            _,train_peak=tracemalloc.get_traced_memory();tracemalloc.stop()
            cases=[]
            for context,frame,left,right in FRAMES:
                for i in range(lexical_tests):
                    a,b=f'traveller{i}',f'map{i}'
                    text=frame.format(a=a,b=b);assert text not in training
                    cases.append({'kind':'new_words','context':context,'text':text,'expected':{left:a,right:b}})
                for i in range(5):
                    text=frame.format(a=f'young traveller{i}',b=f'map{i}')
                    cases.append({'kind':'new_structure','context':context,'text':text,'expected':None})
                    original=frame.format(a=f'traveller{i}',b=f'map{i}')
                    cases.append({'kind':'missing_punctuation','context':context,'text':original[:-1],'expected':None})
            assert len({(c['context'],c['text']) for c in cases})==len(cases)
            random.Random(19).shuffle(cases)
            before=engine.db.total_changes;stats={};latencies=[];samples=[]
            tracemalloc.start();start=time.perf_counter()
            for case in cases:
                t=time.perf_counter()
                result=engine.text_memory.parse(case['text'],engine.meaning_memory.scope(case['context'],'expressions'))
                latencies.append((time.perf_counter()-t)*1000)
                s=stats.setdefault(case['kind'],{'total':0,'correct_records':0,'unknown':0,'ambiguous':0,'wrong_unique':0})
                s['total']+=1
                if result['status'] in ('unknown','ambiguous'):s[result['status']]+=1
                elif result['status']=='predicted':
                    if case['expected'] is not None and result['candidates'][0]['record']==case['expected']:s['correct_records']+=1
                    else:s['wrong_unique']+=1
                if len(samples)<6:samples.append({'kind':case['kind'],'text':case['text'],'status':result['status']})
            inference_seconds=time.perf_counter()-start
            _,inference_peak=tracemalloc.get_traced_memory();tracemalloc.stop()
            assert before==engine.db.total_changes
            conflicts=[]
            for context,frame,left,right in FRAMES:
                contradiction=[{'text':frame.format(a=f'person{i}',b=f'object{i}'),'record':{left:f'object{i}',right:f'person{i}'}} for i in range(3)]
                engine.meaning_memory.learn_expressions(contradiction,context)
                r=engine.text_memory.parse(frame.format(a='traveller',b='maps'),engine.meaning_memory.scope(context,'expressions'))
                conflicts.append({'context':context,'status':r['status'],'candidates':[c['record'] for c in r['candidates']]})
            latencies.sort()
            pages=engine.db.execute('PRAGMA page_count').fetchone()[0];page_size=engine.db.execute('PRAGMA page_size').fetchone()[0]
            return {'training_records':per_frame*len(FRAMES),'per_frame':per_frame,'training_seconds':training_seconds,
                    'training_python_peak_bytes':train_peak,'inference_python_peak_bytes':inference_peak,
                    'sqlite_allocated_bytes_after_conflicts':pages*page_size,'test_cases':len(cases),'groups':stats,
                    'inference_seconds':inference_seconds,'latency_ms_median':latencies[len(latencies)//2],
                    'latency_ms_p95':latencies[int(.95*(len(latencies)-1))],
                    'conflict_checks':conflicts,'samples':samples,'inference_learning_updates':0,
                    'lookup_baseline_correct_new_word_cases':0}
        finally:
            if tracemalloc.is_tracing():tracemalloc.stop()
            engine.close()


def evaluate(sizes=(6,30,100,300)):
    return {'scope':'Synthetic supervised fixed-frame scaling, with context supplied; not a natural-language or general-intelligence benchmark.',
            'runs':[benchmark(n) for n in sizes],
            'limits':['Artificial words, six supplied frame contexts, no automatic intent/context routing.',
                      'Memory metrics cover traced Python allocations and SQLite pages, not total process/native memory.',
                      'Timing is from one run per size in this environment, with allocation tracing enabled.',
                      'Grammar tests deliberately require structures absent from the hypothesis language.',
                      'Baseline is exact training-sentence lookup; all new-word inputs are absent, so it abstains.'],
            'model_calls':0}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--sizes',nargs='+',type=int,default=[6,30,100,300]);args=parser.parse_args()
    if any(n<3 or n>1000 for n in args.sizes):parser.error('3..1000 records per frame required')
    print(json.dumps(evaluate(args.sizes),indent=2))
