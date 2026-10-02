"""Test text-only learning without installing a QA rule or supplying QA pairs.

The fictional passages are the only learning inputs. Expected answers are used
solely by the evaluator. Failure describes this implementation, not every
possible pattern-memory architecture.
"""
import json
from engine import Engine

PASSAGES=[
 'Luma is a robot. Luma lives in Arin. Arin is in Nelo. Luma carries a green box. The green box contains a key.',
 'Luma moved the key into a red bag. The red bag is inside the drawer.'
]
QUESTIONS=[
 {'question':'What is Luma?','expected':'robot'},
 {'question':'Where does Luma live?','expected':'Arin'},
 {'question':'What color is the box Luma carries?','expected':'green'},
 {'question':'What does the green box contain?','expected':'key'},
 {'question':'Where did Luma move the key?','expected':'red bag'},
 {'question':'Where is the key now?','expected':'drawer'}
]
CLOZE=[
 {'text':'We learned that Luma is a <mask>.','expected':'robot'},
 {'text':'We learned that Luma lives in <mask>.','expected':'Arin'},
 {'text':'We learned that Luma carries a <mask> box.','expected':'green'},
 {'text':'We learned that the green box contains a <mask>.','expected':'key'},
 {'text':'We learned that Luma moved the key into a red <mask>.','expected':'bag'},
 {'text':'From these facts, the key is now in the <mask>.','expected':'drawer'}
]

def evaluate():
 engine=Engine(database=':memory:');context='fictional-reading-test'
 try:
  for index,passage in enumerate(PASSAGES):
   engine.text_gaps.learn(passage,f'synthetic:fictional-passage:{index}',context)
  questions=[];before=engine.db.total_changes
  for item in QUESTIONS:
   try:
    output=engine.text_gaps.predict(item['question'],context)
    status=output['status'];reason=None
   except ValueError as error:
    status='unsupported_question';reason=str(error)
   # No conversion of question to cloze is passed to the model. The request
   # router also receives no labeled request examples in this experiment.
   routing=engine.request_patterns.route(item['question'])
   questions.append(dict(item,status=status,reason=reason,request_routing=routing['status'],answer=None))
  if engine.db.total_changes!=before:raise RuntimeError('questions changed training memory')
  cloze=engine.text_gaps.evaluate(CLOZE,context)
  # The final cloze requires tracking the move and composing two facts. Its
  # answer, if matched, may result from a nearby phrase; this is not proof of
  # inference. Report all candidates and their provenance for inspection.
  probe=engine.text_gaps.predict(CLOZE[-1]['text'],context)
  control_engine=Engine(database=':memory:')
  try:
   control_passages=[PASSAGES[0],PASSAGES[1].replace('moved the key','moved a coin')]
   for index,passage in enumerate(control_passages):
    control_engine.text_gaps.learn(passage,f'synthetic:counterfactual:{index}',context)
   control_prediction=control_engine.text_gaps.predict(CLOZE[-1]['text'],context)
   control={'passages':control_passages,'probe':CLOZE[-1]['text'],'expected':'box',
            'preferred':[c['token'] for c in control_prediction['preferred']],
            'correct':len(control_prediction['preferred'])==1 and control_prediction['preferred'][0]['token']=='box',
            'interpretation':'Only the coin moved. The key remains in the green box. This controls for superficial matches to drawer.'}
  finally:control_engine.close()
  return {'counterfactual_control':control,'training':{'passages':PASSAGES,'question_answer_examples':0,'model_calls':0},
          'direct_questions':questions,'direct_answers_produced':0,'direct_questions_total':len(questions),
          'cloze':cloze,'multi_fact_probe':probe,'question_learning_updates':0,
          'interpretation':'This prototype predicts word contexts but has no trained passage-to-question answering mechanism. A cloze hit does not prove factual reasoning.',
          'scope':'Small fictional synthetic experiment; not a real-corpus or universal-intelligence evaluation.'}
 finally:engine.close()

if __name__=='__main__':print(json.dumps(evaluate(),indent=2))
