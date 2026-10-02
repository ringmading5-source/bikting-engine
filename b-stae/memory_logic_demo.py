"""Synthetic structured-memory transfer experiment; no model calls."""
import json
from engine import Engine

EXAMPLES=[{'input':{'entity':word,'count':count},'output':{'form':word+'s','count':count,'multiple':multiple}}
          for word,count,multiple in [('cat',0,False),('dog',1,False),('horse',2,True),('bird',3,True)]]

def evaluate():
    engine=Engine(database=':memory:')
    try:
        learner=engine.memory_logic;learned=learner.learn(EXAMPLES,'quantity');before=engine.db.total_changes;cases=[]
        for word,count in [('rabbit',3),('goat',1),('café',5)]:
            record={'entity':word,'count':count};result=learner.predict(record,'quantity')
            expected={'form':word+'s','count':count,'multiple':count>1}
            cases.append({'input':record,'expected':expected,'result':result,'correct':result['status']=='predicted' and result['candidates'][0]['record']==expected})
        assert engine.db.total_changes==before
        exceptions=[{'input':{'entity':word,'count':n},'output':{'form':form,'count':n,'multiple':True}}
                    for word,form,n in [('mouse','mice',2),('sheep','sheep',3),('person','people',4)]]
        exception_learning=learner.learn(exceptions,'quantity')
        return {'training':EXAMPLES,'learned':learned,'cases':cases,'correct':sum(c['correct'] for c in cases),'total':len(cases),
                'exceptions_retained':exception_learning,'mouse_prediction':learner.predict({'entity':'mouse','count':2},'quantity'),
                'model_calls':0,'test_learning_updates':0,
                'limits':'Supplied structured labels; no raw-text parsing, acquired concept semantics, word-level induction or automatic exception routing. Character/byte bindings share a generic sequence mechanism.'}
    finally:engine.close()

if __name__=='__main__':print(json.dumps(evaluate(),indent=2,ensure_ascii=False))
