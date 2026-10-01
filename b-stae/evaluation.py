"""Reproducible synthetic capability evaluation. Independent in-memory engine.

Run: python evaluation.py. Test inputs are disjoint from fitting/validation inputs.
A small fixed simulator benchmark cannot establish general intelligence.
"""
import json
import random
from engine import Engine
from transition_learning import TransitionLearning
from coupled_transition_learning import CoupledTransitionLearning

def demo():
    item=observation(7,9)
    return {'training':{'action':'coupled_learn','examples':[observation(0,0),observation(20,0),observation(0,20),observation(20,20)],'validation':[observation(5,10)]},'prediction':{'action':'coupled_predict','model_id':'','state':item['before'],'transition_action':item['action'],'context':item['context'],'relationships':item['relationships']}}


def observation(x,y,coefficient=1):
    return {'before':{'stock':x,'incoming':y},'after':{'stock':x+coefficient*y,'incoming':y},'action':'receive','context':{'mode':str(coefficient)},'relationships':[{'from':'incoming','kind':'adds_to','to':'stock'}],'outcome':'observed','source':'synthetic:evaluation-v1'}


def evaluate():
    from behavior_library import BehaviorLibrary
    from task_runtime import TaskRuntime
    from gemini_adapter import GeminiAdapter
    from goal_planner import GoalPlanner
    engine=Engine(database=':memory:');cases=[]
    def record(category,name,passed,details=None):cases.append({'category':category,'case':name,'passed':bool(passed),'details':details})
    try:
        rng=random.Random(1729);coupled=CoupledTransitionLearning(engine);baseline=TransitionLearning(engine)
        training_points=[(0,0),(20,0),(0,20),(20,20),(10,5)]
        validation_points=[(5,10),(15,15)]
        used=set(training_points+validation_points)
        test_points=[]
        while len(test_points)<20:
            pair=(rng.randrange(1,20),rng.randrange(1,20))
            if pair not in used:used.add(pair);test_points.append(pair)
        for coefficient in (1,2):
            training=[observation(x,y,coefficient) for x,y in training_points]
            validation=[observation(x,y,coefficient) for x,y in validation_points]
            base=baseline.learn(training,validation)
            record('baseline_limit',f'fieldwise_rejects_coupling_{coefficient}',base['status']=='unsupported_pattern',base['status'])
            learned=coupled.learn(training,validation)
            record('fitting',f'coupled_identification_{coefficient}',learned['status']=='hypothesis_saved')
            if learned['status']!='hypothesis_saved':continue
            ident=learned['model_id']
            for x,y in test_points:
                test=observation(x,y,coefficient)
                result=coupled.predict(ident,test['before'],test['action'],test['context'],test['relationships'])
                record('held_out_prediction',f'mode{coefficient}_{x}_{y}',result.get('state')==test['after'] and result.get('verified_outcome') is False)
            wrong=observation(7,9,3)
            result=coupled.predict(ident,wrong['before'],wrong['action'],wrong['context'],wrong['relationships'])
            record('context_rejection',f'unseen_mode_{coefficient}',result['status']=='context_mismatch')
        tasks=TaskRuntime(engine,GeminiAdapter(engine));planner=GoalPlanner(tasks)
        for value,goal in [('  alpha  ',{'all':['trimmed','uppercase']}),([4,-1,4,2],{'all':['sorted_ascending']})]:
            result=planner.execute(value,goal)
            record('composition','goal_'+str(value),result.get('verified') and result['model_calls']==0)
        nonlinear=[]
        for x,y in training_points:
            item=observation(x,y);item['after']['stock']=x+y*y;nonlinear.append(item)
        record('unsupported_rejection','nonlinear_transition',coupled.learn(nonlinear,[observation(4,6)])['status']=='unsupported_pattern')
        summary={}
        for case in cases:
            row=summary.setdefault(case['category'],{'passed':0,'total':0});row['total']+=1;row['passed']+=int(case['passed'])
        return {'benchmark':'bstae-synthetic-v1','seed':1729,'passed':sum(c['passed'] for c in cases),'total':len(cases),'summary':summary,'cases':cases,'model_calls':0,'scope':'fixed synthetic benchmark; no natural-language, perception, causal or universal-intelligence claim','split':'training, validation and test state pairs are disjoint'}
    finally:engine.close()

if __name__=='__main__':print(json.dumps(evaluate(),indent=2))
