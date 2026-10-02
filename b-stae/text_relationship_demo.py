"""Text relationship transfer with held-out subjects and answer values."""
import json
from engine import Engine

EXAMPLES=[{'statement':f'The {subject} drinks {object}.','question':f'What does the {subject} drink?',
           'answer':object,'source':'synthetic:labeled-text'}
          for subject,object in [('cat','milk'),('dog','water'),('child','juice')]]
TESTS=[('robot','lemonade'),('traveller','coffee'),('little brown horse','fresh spring water')]

def evaluate():
 engine=Engine(database=':memory:')
 try:
  learner=engine.text_relations;learned=learner.learn(EXAMPLES,'drink-experiment')
  cases=[];before=engine.db.total_changes
  for subject,object in TESTS:
   statement=f'The {subject} drinks {object}.';question=f'What does the {subject} drink?'
   output=learner.answer(statement,question,'drink-experiment')
   generated=learner.transform(statement,'drink-experiment')
   cases.append({'statement':statement,'question':question,'expected':object,
                 'answer':output['candidates'][0]['answer'] if len(output['candidates'])==1 else None,
                 'status':output['status'],'correct':output['status']=='answered' and output['candidates'][0]['answer']==object,
                 'generated_question':generated['candidates'][0]['question'] if len(generated['candidates'])==1 else None,
                 'answer_absent_from_training':all(object!=e['answer'] for e in EXAMPLES),
                 'question_absent_from_training':all(question.casefold()!=e['question'].casefold() for e in EXAMPLES)})
  if engine.db.total_changes!=before:raise RuntimeError('test mutated memory')
  unsupported=learner.answer('The bird eats seeds.','What does the bird eat?','drink-experiment')
  return {'training_examples':EXAMPLES,'learned':learned,'cases':cases,'correct':sum(c['correct'] for c in cases),'total':len(cases),
          'unseen_verb_status':unsupported['status'],'model_calls':0,'learning_updates_during_test':0,
          'scope':'Supervised text frame/slot transfer. New output values copied from new input; no raw-text semantic discovery or arbitrary grammar.'}
 finally:engine.close()
if __name__=='__main__':print(json.dumps(evaluate(),indent=2))
