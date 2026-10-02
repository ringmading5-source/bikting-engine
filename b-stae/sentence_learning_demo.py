"""Synthetic multiword and sentence-length prediction benchmark."""
import json
from engine import Engine
TRAINING=[
 'The plant uses sunlight to make food during the day.',
 'The robot places the red block on the table before resting.',
 'First observation: the ball rolls down the hill. Next observation: the door opens.',
 'The child likes warm tea after dinner.',
 'The child likes fresh juice after dinner.'
]
CASES=[
 {'text':'Today the plant <mask> during the day.','expected':'uses sunlight to make food'},
 {'text':'Today the robot <mask> before resting.','expected':'places the red block on the table'},
 {'text':"Today's first observation: <mask> Next observation: a new event.",'expected':'the ball rolls down the hill.'},
 {'text':'Today the child likes <mask> after dinner.','expected':'warm tea'},
 {'text':'quasar <mask> nebula','expected':'shines brightly'}
]
def evaluate():
 engine=Engine(database=':memory:')
 try:
  for index,text in enumerate(TRAINING):engine.text_gaps.learn(text,f'synthetic:sentence-span:{index}')
  report=engine.sentences.evaluate(CASES)
  continuation=engine.sentences.continue_sentence('Today the plant')
  report['continuation']={'status':continuation['status'],'preferred':[c['completed_sentence'] for c in continuation['preferred']]}
  report['model_calls']=0;report['scope']='Synthetic retrieval of observed phrases/sentences into unseen prompts. No unrestricted generation.'
  return report
 finally:engine.close()
if __name__=='__main__':print(json.dumps(evaluate(),indent=2))
