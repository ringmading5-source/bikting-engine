"""Reproducible synthetic role benchmark with strictly separate split axes."""
import argparse
import hashlib
import json
import random
import time
from pathlib import Path
from engine import Engine
from pattern_memory import encoded

SEED=20261002
VERBS=['push','lift','kick','pull','tap','help','paint','clean','jump','walk','look','talk','pack','wash','brush','turn','roll','fold','plant','count']
NEW_VERBS=['polish','inspect','transport','launch','mark','print','sort','open','fetch','mix']
FORMS=[lambda a,v,o:f'{a} {v}s {o}',lambda a,v,o:f'{o} was {v}ed by {a}',
       lambda a,v,o:f'today {a} {v}s {o}',lambda a,v,o:f'{a} will {v} {o}',
       lambda a,v,o:f'{o} is {v}ed by {a}',lambda a,v,o:f'{a} did {v} {o}']

def record(a,v,o):return {'actor':a,'action':v,'object':o}

def generate(per_form=1600,per_split=600):
    rng=random.Random(SEED);training=[];tests=[]
    subjects=[f'agent{i:04d}' for i in range(200)]
    objects=[f'item{i:04d}' for i in range(200)]
    for form in range(6):
        seen=set()
        for i in range(per_form):
            while True:
                a=rng.choice(subjects);v=VERBS[i%len(VERBS)];o=rng.choice(objects)
                text=FORMS[form](a,v,o)
                if text not in seen:seen.add(text);break
            training.append({'text':text,'record':record(a,v,o),'form':form,'split':'train'})
    all_training={e['text'] for e in training};seen=set(all_training)
    training_triples={encoded(e['record']) for e in training}
    for split in ('new_combinations','new_entities','new_verbs','untrained_wording'):
        for i in range(per_split):
            form=i%6
            while True:
                a=rng.choice(subjects);o=rng.choice(objects);v=rng.choice(VERBS)
                if split=='new_entities':a=f'unseenactor{i:04d}';o=f'unseenobject{i:04d}'
                if split=='new_verbs':v=NEW_VERBS[i%len(NEW_VERBS)]
                text=FORMS[form](a,v,o)
                if split=='untrained_wording':
                    text=f'{a} {v}s {o}.' if i%3==0 else f'{a} never {v}s {o}' if i%3==1 else f'can {a} {v} {o}'
                if text not in seen and (split!='new_combinations' or encoded(record(a,v,o)) not in training_triples):seen.add(text);break
            tests.append({'text':text,'record':record(a,v,o),'form':form,'split':split})
    assert not all_training & {e['text'] for e in tests}
    assert not training_triples & {encoded(e['record']) for e in tests if e['split']=='new_combinations'}
    return training,tests

def clean(e):return {'text':e['text'],'record':e['record']}

def batches(items):
    # Avoid a final remainder too small to induce a template.
    while len(items)>32:
        n=32 if len(items)>=35 else len(items)-3
        yield items[:n];items=items[n:]
    if len(items)>=3:yield items

def evaluate(engine,tests):
    metrics={};examples=[];baseline=0
    before=engine.db.total_changes
    for e in tests:
        r=engine.roles.parse(e['text'])
        predicted=r['status']=='predicted'
        correct=predicted and r['candidates'][0]['record']==e['record']
        group=metrics.setdefault(e['split'],{'total':0,'correct':0,'wrong_predictions':0,'unknown':0,'ambiguous':0,'bounded':0})
        group['total']+=1;group['correct']+=int(correct)
        group['wrong_predictions']+=int(predicted and not correct)
        if r['status'] in ('unknown','ambiguous','bounded'):group[r['status']]+=1
        words=e['text'].split()
        naive=record(words[0],words[1][:-1] if words[1].endswith('s') else words[1],words[-1])
        baseline+=int(naive==e['record'])
        if len([x for x in examples if x['split']==e['split']])<3:
            examples.append({'split':e['split'],'text':e['text'],'expected':e['record'],'status':r['status'],
                             'predictions':[c['record'] for c in r['candidates'][:3]]})
    for m in metrics.values():
        m['accuracy']=m['correct']/m['total']
        answered=m['correct']+m['wrong_predictions']
        m['precision_when_predicted']=m['correct']/answered if answered else None
    return {'splits':metrics,'exact_retrieval_accuracy':0.0,'fixed_position_baseline_accuracy':baseline/len(tests),
            'inference_writes':engine.db.total_changes-before,'examples':examples}

def run(output,stages=(3,18,30,300,3000,9600),per_form=1600,per_split=600):
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    training,tests=generate(per_form,per_split)
    dataset=output/'synthetic_language_roles.jsonl'
    with dataset.open('w') as stream:
        for e in training+tests:stream.write(json.dumps(e)+'\n')
    report={'seed':SEED,'training_records':len(training),'test_records':len(tests),'total_records':len(training)+len(tests),
            'dataset_sha256':hashlib.sha256(dataset.read_bytes()).hexdigest(),'stages':[],
            'scope':'Supervised role templates; no learned passage facts, causal reasoning, natural speech or real images.',
            'method':'Fresh model per stage. Same held-out sets at every stage; full sentences disjoint. Training grouped by supplied form ID. No test-driven tuning.',
            'model_calls':0}
    for n in stages:
        if n>len(training):continue
        e=Engine(database=':memory:');started=time.perf_counter()
        try:
            if n==3:counts=[3,0,0,0,0,0]
            else:counts=[n//6+(i<n%6) for i in range(6)]
            selected=[]
            for form,count in enumerate(counts):
                group=[x for x in training if x['form']==form][:count];selected.extend(group)
                for batch in batches(group):e.roles.learn([clean(x) for x in batch])
            evaluation=evaluate(e,tests)
            summary={'training_examples':len(selected),'trained_forms':sum(c>=3 for c in counts),
                     'seconds':time.perf_counter()-started,**evaluation}
            report['stages'].append(summary)
            if n==max(stages):
                from bstae import Model
                # SDK checkpoint of this fully trained engine, no retraining.
                with Model() as saved:
                    e.db.backup(saved.components.db)
                    saved.save(output/'trained_language_model.sqlite3')
            (output/'generalization_results.json').write_text(json.dumps(report,indent=2))
            print(json.dumps({'training':len(selected),'seconds':round(summary['seconds'],2),
                              'accuracy':{k:round(v['accuracy'],4) for k,v in evaluation['splits'].items()}}),flush=True)
        finally:e.close()
    report['fixed_form_control']=[]
    subset=[x for x in tests if x['split']!='untrained_wording' and x['form']==0]
    for count in (3,30,300,per_form):
        if count>per_form:continue
        e=Engine(database=':memory:')
        try:
            for batch in batches([x for x in training if x['form']==0][:count]):e.roles.learn([clean(x) for x in batch])
            report['fixed_form_control'].append({'training_examples':count,'trained_forms':1,**evaluate(e,subset)})
        finally:e.close()
    (output/'generalization_results.json').write_text(json.dumps(report,indent=2))
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);args=parser.parse_args()
    run(args.output)
