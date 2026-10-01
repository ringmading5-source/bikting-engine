"""Run python pattern_memory_demo.py; no GPU, model API, or network needed."""
import json
from engine import Engine

def demo():
    engine=Engine(database=':memory:')
    try:
        memory=engine.patterns
        memory.observe_text('The cat drinks milk.', 'demo:one')
        memory.observe_text('The child drinks water.', 'demo:two')
        completion=memory.complete(['The','dog','drinks'], 'word')
        memory.learn_pair(['a','b'], ['a','b','a'], 'character', 'demo:copy')
        prediction=memory.predict(['x','y'], 'character')
        memory.learn_pair(['c','d'], ['d','c'], 'character', 'demo:reverse')
        conflict=memory.predict(['x','y'], 'character')
        return {'unseen_prefix':completion,'unseen_structure':prediction,
                'retained_conflict':conflict,'memory':memory.stats(),'model_calls':0,
                'scope':'Structural analogy and continuation evidence; not general question answering.'}
    finally: engine.close()

if __name__=='__main__': print(json.dumps(demo(),indent=2))
