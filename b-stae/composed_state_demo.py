import json
from engine import Engine

WORDS=('cat','dog','horse')
PLURAL=[{'before':w,'after':w+'s','source':'synthetic:paired'} for w in WORDS]
SENTENCE=[{'before':w,'after':'The '+w+' sleeps.','source':'synthetic:paired'} for w in WORDS]
REPORT=[{'before':'The '+w+' sleeps.','after':'Report: The '+w+' sleeps.','source':'synthetic:paired'} for w in WORDS]

def evaluate():
    e=Engine(database=':memory:')
    try:
        modes=[]
        for mode in ('character','byte'):
            learned=[e.composed_states.learn(examples,context,mode) for context,examples in [('plural',PLURAL),('sentence',SENTENCE),('report',REPORT)]]
            before=e.db.total_changes
            plural=e.composed_states.predict('rabbit','plural',mode)
            composition=e.composed_states.compose('rabbit',['sentence','report'],mode)
            unicode=e.composed_states.compose('café',['sentence','report'],mode)
            assert before==e.db.total_changes
            modes.append({'mode':mode,'training':learned,'plural':plural,'composition':composition,'unicode':unicode,
                          'correct':plural['candidates'][0]['text']=='rabbits' and composition['candidates'][0]['text']=='Report: The rabbit sleeps.',
                          'inference_learning_updates':0})
        return {'runs':modes,'model_calls':0,'scope':'Learned paired concatenation rewrites and their composition. Output sentences are symbolic test targets, not discovered facts.'}
    finally:e.close()
if __name__=='__main__':print(json.dumps(evaluate(),indent=2,ensure_ascii=False))
