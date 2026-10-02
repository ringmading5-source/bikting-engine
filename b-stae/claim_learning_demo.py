"""Small learned assertion/denial/question benchmark, with novel word stems."""
import json
from engine import Engine

FORMS=[('assertion',True,lambda a,v,o:f'{a} {v}s {o}.'),
       ('assertion',False,lambda a,v,o:f'{a} does not {v} {o}.'),
       ('assertion',False,lambda a,v,o:f'{a} never {v}s {o}.'),
       ('question',True,lambda a,v,o:f'can {a} {v} {o}?'),
       ('question',True,lambda a,v,o:f'does {a} {v} {o}?'),
       ('question',False,lambda a,v,o:f'does {a} not {v} {o}?')]

def example(form,actor,action,obj):
    mode,polarity,render=FORMS[form]
    return {'text':render(actor,action,obj),'record':{'actor':actor,'action':action,'object':obj,'mode':mode,'polarity':polarity}}

def train(e,context=None):
    return [e.claims.learn([example(i,a,v,o) for a,v,o in [('cat','push','box'),('dog','lift','cart'),('bird','kick','ball')]],'synthetic:claim-alignment',context) for i in range(len(FORMS))]

def run(per_form=200):
    e=Engine(database=':memory:')
    try:
        learned=train(e);before=e.db.total_changes;cases=[]
        for level in ('byte','character'):
            for i in range(len(FORMS)):
                for index in range(per_form):
                    a=f'newactor{index:04d}' if index%7 else f'猫{index:04d}'
                    v=('inspect','mark','print','transport')[index%4]
                    o=f'newobject{index:04d}'
                    expected=example(i,a,v,o);r=e.claims.parse(expected['text'],level=level)
                    cases.append({'input':expected['text'],'level':level,'expected':expected['record'],
                                  'status':r['status'],'correct':r['status']=='predicted' and r['candidates'][0]['record']==expected['record']})
        inference_writes=e.db.total_changes-before
        e.coherence.observe({'kind':'capability','subject':'cat','action':'speak','object':'English','allowed':False,'context':None},'synthetic:capability')
        checks={text:e.coherence.inspect(text) for text in ['cat speaks English.','cat does not speak English.','can cat speak English?','does cat not speak English?']}
        return {'correct':sum(c['correct'] for c in cases),'total':len(cases),'cases':cases,'coherence':checks,
                'inference_writes':inference_writes,'training_examples':18,'model_calls':0,'distinct_holdout_sentences':6*per_form,
                'unsupported':e.claims.parse('it is not true that cat speaks English'),
                'scope':'Six labeled synthetic templates; learned role and mode/polarity alignment, not arbitrary negation or event understanding.'}
    finally:e.close()

if __name__=='__main__':print(json.dumps(run(),indent=2,ensure_ascii=False))
