"""Independent training sets; complete solution trajectories never supplied."""
import json
from engine import Engine


def state(entity,phase,value):return {'entity':entity,'phase':phase,'value':value}

def train(e):
    for name,x in [('a',2),('b',7),('c',13)]:
        e.behavior.observe(state(name,'start',x),state(name,'middle',x+5),'synthetic:independent-step','offset')
    for name,x in [('d',3),('e',11),('f',23)]:
        e.behavior.observe(state(name,'middle',x),state(name,'end',2*x),'synthetic:independent-step','scale')

def run():
    e=Engine(database=':memory:')
    try:
        train(e);cases=[]
        for x in range(-50,150):
            initial=state(f'unseen{x}','start',x);target=state(f'unseen{x}','end',2*(x+5))
            result=e.composition.solve(initial,target,['scale','offset'])
            cases.append({'initial':initial,'target':target,'correct':result['status']=='goal_satisfied' and result['result']==target and len(result['plan'])==2})
        replay=e.composition.solve(cases[0]['initial'],cases[0]['target'],['scale','offset'])
        e.behavior.observe(state('a','start',2),state('a','middle',99),'synthetic:counterevidence','offset')
        conflict=e.composition.solve(cases[0]['initial'],cases[0]['target'],['scale','offset'])
        return {'correct':sum(c['correct'] for c in cases),'total':len(cases),'training_pairs':6,
                'supplied_complete_trajectories':e.db.execute('SELECT count(*) FROM behavior_episodes').fetchone()[0],
                'remembered':replay,'counterevidence':conflict,'example':cases[0],'model_calls':0,
                'scope':'learned structured transformations and bounded goal-directed composition; not natural-language fact inference or general intelligence'}
    finally:e.close()

if __name__=='__main__':print(json.dumps(run(),indent=2))
