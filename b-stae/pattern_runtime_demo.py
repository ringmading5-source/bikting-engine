"""End-to-end learned composition and retained outcome evidence benchmark."""
import json
from engine import Engine
from relationship_discovery import apply

def evaluate():
    engine=Engine(database=':memory:');cases=[]
    try:
        functions={'increment':lambda x:x+1,'double':lambda x:2*x}
        for context,function in functions.items():
            for index,units in enumerate(([1,3,5],[2,4,6,8],[0,7,9,11,13])):
                engine.patterns.learn_pair(units,[function(x) for x in units],'number','synthetic:train:'+str(index),context)
            engine.discovery_patterns.discover('number',context)
        for offset in range(20,40):
            units=[offset,offset+3];target=[2*(x+1) for x in units]
            result=engine.pattern_runtime.plan(units,target,'number',['increment','double'],max_depth=2)
            current=units;replay=True;oracle_match=True
            for step in result['plan']:
                current=apply(step['program'],current)
                replay &= current==step['after']
                oracle_match &= current==[functions[step['context']](v) for v in step['before']]
            cases.append({'input':units,'target':target,'status':result['status'],'steps':len(result['plan']),
                          'passed':result['status']=='predicted_goal_matched' and current==target and replay and oracle_match})
        runtime=engine.pattern_runtime
        selected=runtime.select([50,60],'number','increment',[51,61])
        h=selected['preferred'][0]['hypotheses'][0]
        negative=runtime.feedback([50,60],[999,999],h['program'],'number','synthetic:contradiction','increment',[51,61])
        positive=runtime.feedback([50,60],[51,61],h['program'],'number','synthetic:correction','increment',[51,61])
        return {'composition_cases':cases,'passed':sum(c['passed'] for c in cases),'total':len(cases),
                'feedback':[negative,positive],'retained_outcomes':len(runtime.outcomes('number','increment')),
                'model_calls':0,'scope':'Synthetic sequence composition. Targets supplied; no external task execution or universal intelligence claim.'}
    finally:engine.close()

if __name__=='__main__':print(json.dumps(evaluate(),indent=2))
