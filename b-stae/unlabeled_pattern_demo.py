"""Small synthetic benchmark; labels appear only in held-out evaluation."""
import json
from engine import Engine

TRAINING=[f'{name} carries {item}. Later {name} stores {item}.'
          for name,item in [('Mira','amber'),('Kito','jade'),('Sena','silver')]]
CASES=[{'text':'Taro carries copper. Later <mask> stores copper.','expected':'taro'},
       {'text':'Nela carries bronze. Later Nela stores <mask>.','expected':'bronze'},
       {'text':'Vexo carries <mask>. Later Vexo stores quartz.','expected':'quartz'}]

if __name__=='__main__':
    engine=Engine(database=':memory:')
    try:
        learned=engine.unlabeled_patterns.learn(TRAINING)
        report=engine.unlabeled_patterns.evaluate(learned['model_id'],CASES)
        print(json.dumps({'training_labels':0,'learned_parameters':learned['parameters'],
                          'evaluation':report,'model_calls':0},indent=2))
    finally:engine.close()
