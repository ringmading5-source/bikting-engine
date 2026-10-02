import json
from engine import Engine
from memory_logic_demo import EXAMPLES as LOGIC_EXAMPLES

PLURAL=[{'text':f'{quantity} {word}s','record':{'entity':word,'count':count}}
        for quantity,word,count in [('two','cat',2),('three','dog',3),('four','horse',4)]]
SINGULAR=[{'text':f'one {word}','record':{'entity':word,'count':1}} for word in ('cat','dog','horse')]

def evaluate():
    e=Engine(database=':memory:')
    try:
        learned=[e.text_memory.learn(batch,'q') for batch in (PLURAL,SINGULAR)]
        e.memory_logic.learn(LOGIC_EXAMPLES,'quantity')
        before=e.db.total_changes;cases=[]
        for text,record in [('three rabbits',{'entity':'rabbit','count':3}),('two cafés',{'entity':'café','count':2}),('one rabbit',{'entity':'rabbit','count':1})]:
            parsed=e.text_memory.parse(text,'q');expressed=e.text_memory.express(record,'q')
            reasoning=e.memory_logic.predict(parsed['candidates'][0]['record'],'quantity')
            cases.append({'memory_reasoning':reasoning,'text':text,'record':record,'parsed':parsed,'expressed':expressed,
                          'correct':parsed['status']=='predicted' and parsed['candidates'][0]['record']==record and expressed['status']=='predicted' and expressed['candidates'][0]['text']==text})
        assert before==e.db.total_changes
        return {'training':PLURAL+SINGULAR,'learned':learned,'cases':cases,'correct':sum(c['correct'] for c in cases),'total':len(cases),
                'unseen_quantity':e.text_memory.parse('five rabbits','q'),'model_calls':0,'test_learning_updates':0,
                'scope':'Supervised whitespace-token alignment, learned affixes and observed scalar vocabulary. No raw-text concept discovery; unseen quantity words remain unknown.'}
    finally:e.close()
if __name__=='__main__':print(json.dumps(evaluate(),indent=2,ensure_ascii=False))
