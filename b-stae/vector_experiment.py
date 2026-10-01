import json
from engine import Engine

def dataset():
    train=[];test=[]
    for behavior,delta in [('east',[1,0]),('north',[0,1]),('west',[-1,0])]:
        for x in range(-4,5):
            for y in range(-4,5):
                for amount in (1,2):
                    r={'before':[x,y],'after':[x+delta[0]*amount,y+delta[1]*amount], 'relation':'displacement','behavior':behavior,'context':[amount], 'provenance':'synthetic integer grid v1'}
                    (test if (x+y)%4==0 and abs(x)<4 and abs(y)<4 else train).append(r)
    return train,test

def run(db=':memory:'):
    e=Engine(database=db)
    try:
        train,test=dataset();report=e.vector_model.train('grid',train,test)
        actions=[{'relation':'displacement','behavior':b,'context':[1],'min':[-4,-4],'max':[4,4]} for b in ('east','north','west')]
        return {'dataset':'synthetic grid with withheld coordinate pairs','training':len(train),'evaluation':report['evaluation'],'plan':e.vector_model.plan('grid',[0,0],[2,2],actions,max_depth=4)}
    finally:e.close()
if __name__=='__main__':print(json.dumps(run(),indent=2))
