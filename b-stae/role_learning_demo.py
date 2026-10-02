import json
from engine import Engine

def example(actor, action, obj, passive=False):
    text = f'{obj} was {action}ed by {actor}' if passive else f'{actor} {action}s {obj}'
    return {'text': text, 'record': {'actor': actor, 'action': action, 'object': obj}}

TRAIN = [example(a,v,o,p) for p in (False,True) for a,v,o in [('cat','push','box'),('dog','lift','cart'),('bird','kick','ball')]]
HOLDOUT = [example(a,v,o,p) for p in (False,True) for a,v,o in [('cat','lift','ball'),('box','push','cat'),('robot','kick','stone'),('猫','push','箱')]]

def run():
    e = Engine(database=':memory:')
    try:
        report = {'training':TRAIN, 'learning':[e.roles.learn(TRAIN[:3]),e.roles.learn(TRAIN[3:])], 'levels':{},
                  'limits':'Supervised role records; learned affixes and token positions; no arbitrary prose or causality claim.'}
        for level in ('byte','character'):
            before=e.db.total_changes
            report['levels'][level]=e.roles.evaluate(HOLDOUT,level=level)
            report['levels'][level]['evaluation_writes']=e.db.total_changes-before
        report['unseen_wording']=e.roles.parse('the cat has pushed the box')
        e.roles.learn([{'text':x['text'],'record':{'actor':x['record']['object'],'action':x['record']['action'],'object':x['record']['actor']}} for x in TRAIN[:3]])
        report['conflict']=e.roles.parse(HOLDOUT[0]['text'])
        return report
    finally:e.close()

if __name__=='__main__':print(json.dumps(run(),indent=2,ensure_ascii=False))
