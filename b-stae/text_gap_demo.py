"""Transparent synthetic language benchmark, including ambiguity and unknowns."""
import json
from engine import Engine

TRAINING=[
 'The cat drinks milk.', 'The dog drinks water.', 'The fish swims in rivers.',
 'The bird can fly above trees.', 'The leaves are green.',
 'The sky looks blue.', 'The student reads books.', 'The plants need light.',
 'The fire feels warm.', 'The child likes tea.', 'The child likes juice.'
]
CASES=[
 {'text':'Today the cat drinks <mask>.','expected':'milk'},
 {'text':'At home the dog drinks <mask>.','expected':'water'},
 {'text':'Sometimes the <mask> swims in rivers.','expected':'fish'},
 {'text':'A small bird can <mask> above trees.','expected':'fly'},
 {'text':'These leaves are <mask>.','expected':'green'},
 {'text':'Today the sky looks <mask>.','expected':'blue'},
 {'text':'This student reads <mask>.','expected':'books'},
 {'text':'Young plants need <mask>.','expected':'light'},
 {'text':'This fire feels <mask>.','expected':'warm'},
 {'text':'Today the child likes <mask>.','expected':'tea'},
 {'text':'quasar <mask> nebula','expected':'glows'},
 {'text':'enzyme <mask> catalyst','expected':'reacts'}
]

def evaluate():
 engine=Engine(database=':memory:')
 try:
  for index,text in enumerate(TRAINING):engine.text_gaps.learn(text,f'synthetic:sentence:{index}')
  report=engine.text_gaps.evaluate(CASES)
  report['training_sentences']=len(TRAINING);report['model_calls']=0
  report['scope']='Synthetic unseen sentences reuse observed local contexts; includes one ambiguous and two unknown cases. Not semantic understanding.'
  return report
 finally:engine.close()

if __name__=='__main__':print(json.dumps(evaluate(),indent=2))
