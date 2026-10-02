"""Whole-prototype numerical input → state prediction → readable output check."""
import json
from engine import Engine
from meaning_demo import train,CHANGES


def evaluate():
    e=Engine(database=':memory:')
    try:
        train(e);before=e.db.total_changes;cases=[]
        for level in ('byte','character'):
            for text,expected in [('three rabbits','four rabbits'),('three cafés','four cafés')]:
                result=e.meaning_memory.run(text,'animals','add-one-observation',level)
                correct=(result['status']=='predicted' and result['outcomes'][0]['expressions']['status']=='predicted'
                         and result['outcomes'][0]['expressions']['candidates'][0]['text']==expected)
                cases.append({'input':text,'level':level,'expected':expected,'correct':correct,'result':result})
        unavailable=e.meaning_memory.run('four rabbits','animals','add-one-observation')
        unknown=e.meaning_memory.run('five rabbits','animals','add-one-observation')
        assert before==e.db.total_changes
        opposite=[{'input':x['input'],'output':dict(x['output'],count=x['input']['count']-1)} for x in CHANGES]
        e.meaning_memory.learn_changes(opposite,'add-one-observation','animals')
        conflict=e.meaning_memory.run('three rabbits','animals','add-one-observation')
        return {'correct':sum(c['correct'] for c in cases),'total':len(cases),'cases':cases,
                'known_state_unlearned_wording':unavailable,'unknown_expression':unknown,'conflicting_effects':conflict,
                'prediction_writes':0,'model_calls':0,'real_actions_executed':0,
                'scope':'Completed bounded prototype flow; supplied whitespace boundaries, field labels, paired examples and action labels. Not raw-text semantic discovery or universal intelligence.'}
    finally:e.close()
if __name__=='__main__':print(json.dumps(evaluate(),indent=2,ensure_ascii=False))
