import json
from engine import Engine
from text_memory_demo import PLURAL,SINGULAR

RELATIONS=[{'input':{'entity':word,'count':n},'output':{'multiple':label}}
           for word,n,label in [('cat',0,False),('dog',1,False),('horse',2,True),('bird',3,True)]]
CHANGES=[{'input':{'entity':word,'count':n},'output':{'entity':word,'count':after}}
         for word,n,after in [('cat',1,2),('dog',2,3),('horse',4,5)]]

def train(engine):
    m=engine.meaning_memory
    return [m.learn_expressions(batch,'animals') for batch in (PLURAL,SINGULAR)]+[
            m.learn_relations(RELATIONS,'animals'),m.learn_changes(CHANGES,'add-one-observation','animals')]

def evaluate():
    e=Engine(database=':memory:')
    try:
        trained=train(e);before=e.db.total_changes
        reading=e.meaning_memory.inspect('three rabbits','animals')
        count=e.meaning_memory.read_field('three rabbits','count','animals')
        multiple=e.meaning_memory.read_field('three rabbits','multiple','animals')
        unknown=e.meaning_memory.inspect('five rabbits','animals')
        assert before==e.db.total_changes
        predicted=reading['readings'][0]['predicted_changes'][0]['prediction']
        return {'training':trained,'unseen_reading':reading,'count_query':count,'multiple_query':multiple,
                'checks':{'count':count['values']==[3],'multiple':multiple['values']==[True],
                          'change':predicted['status']=='predicted' and predicted['candidates'][0]['record']=={'entity':'rabbit','count':4},
                          'unknown':unknown['status']=='unknown'},'model_calls':0,'test_learning_updates':0,
                'scope':'Supplied entity/count/multiple labels and paired transitions. Action wording is an identifier; its effect is fitted from examples, not understood from the label.'}
    finally:e.close()
if __name__=='__main__':print(json.dumps(evaluate(),indent=2,ensure_ascii=False))
