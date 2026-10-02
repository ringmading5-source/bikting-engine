"""Expanded synthetic labeled text training; held-out entities and objects."""
import json
from engine import Engine

PAIRS=[('robot','tools'),('farmer','seeds'),('child','books'),('teacher','papers'),('worker','boxes'),('doctor','supplies')]
FRAMES=[('carrying','A {a} carries {b}.','carrier','item'),
        ('giving','The {a} gives {b}.','giver','gift'),
        ('finding','The {a} finds {b}.','finder','found'),
        ('liking','The {a} likes {b}.','person','liked'),
        ('using','The {a} uses {b}.','user','used'),
        ('holding','The {a} holds {b}.','holder','held')]

def evaluate(database=':memory:'):
    e=Engine(database=database)
    try:
        training=[];cases=[]
        for context,frame,left,right in FRAMES:
            examples=[{'text':frame.format(a=a,b=b),'record':{left:a,right:b}} for a,b in PAIRS]
            learned=e.meaning_memory.learn_expressions(examples,context)
            training.append({'context':context,'examples':examples,'status':learned['status']})
        before=e.db.total_changes
        for context,frame,left,right in FRAMES:
            for a,b in [('traveller','maps'),('artist','brushes'),('pilot','radios')]:
                text=frame.format(a=a,b=b);expected={left:a,right:b}
                result=e.meaning_memory.run(text,context)
                correct=result['status']=='predicted' and result['outcomes'][0]['record']==expected and result['outcomes'][0]['expressions']['candidates'][0]['text']==text
                cases.append({'context':context,'text':text,'expected':expected,'correct':correct,'result':result})
        unknowns=[{'text':text,'status':e.meaning_memory.run(text,'carrying')['status']}
                  for text in ('A traveller carried maps.','A young traveller carries maps.','Maps are carried by a traveller.')]
        assert e.db.total_changes==before
        return {'training_examples':36,'training':training,'correct':sum(c['correct'] for c in cases),'total':len(cases),'cases':cases,
                'unlearned_wording':unknowns,'test_learning_updates':0,'model_calls':0,
                'scope':'Six separately labeled fixed sentence frames. No raw-text meaning discovery, automatic frame routing or unrestricted grammar.'}
    finally:e.close()
if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--db',default=':memory:')
    args=parser.parse_args();print(json.dumps(evaluate(args.db),indent=2))
