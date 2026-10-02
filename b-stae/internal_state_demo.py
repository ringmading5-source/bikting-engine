import json
from engine import Engine

PAIRS=[{'before':f'the {subject} carries {object}.','after':f'{object} are carried by the {subject}.','source':'synthetic:paired'}
       for subject,object in [('cat','books'),('dog','tools'),('farmer','seeds')]]
TESTS=[('the traveller carries maps.','maps are carried by the traveller.'),
       ('the young traveller carries old maps.','old maps are carried by the young traveller.'),
       ('the 猫 carries maps.','maps are carried by the 猫.')]

def evaluate():
    e=Engine(database=':memory:')
    try:
        runs=[]
        for mode in ('character','byte'):
            learned=e.internal_states.learn(PAIRS,'reorder',mode);before=e.db.total_changes;cases=[]
            for text,target in TESTS:
                r=e.internal_states.predict(text,'reorder',mode)
                cases.append({'input':text,'target':target,'result':r,'correct':r['status']=='predicted' and r['candidates'][0]['text']==target})
            unknown=e.internal_states.predict('the traveller carried maps.','reorder',mode)
            ambiguous=e.internal_states.predict('the robot carries books carries maps.','reorder',mode)
            assert before==e.db.total_changes
            runs.append({'mode':mode,'learned':learned,'cases':cases,'correct':sum(c['correct'] for c in cases),'total':len(cases),
                         'untrained_verb_form':unknown,'repeated_anchor':ambiguous,'inference_writes':0})
        return {'runs':runs,'training_pairs':PAIRS,'model_calls':0,
                'scope':'Supervised copying/reordering on learned state units. No hand-installed carry/passive grammar or supplied word boundaries; paired outputs still supplied. Mixed-language cases are symbolic tests, not grammatical claims.'}
    finally:e.close()
if __name__=='__main__':print(json.dumps(evaluate(),indent=2,ensure_ascii=False))
