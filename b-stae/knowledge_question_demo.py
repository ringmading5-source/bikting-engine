import json
from engine import Engine

SUBJECTS=('biology','physics','history','art','music','law')
FORMS=[('what-is','what is {subject}?'),('define','define {subject}'),('tell-about','tell me about {subject}')]
FACTS=[{'subject':'chemistry','definition':'Chemistry is the study of matter, its properties, and its changes.','source':'manually-written:demo'},
       {'subject':'organic chemistry','definition':'Organic chemistry studies carbon compounds, including their structures and reactions.','source':'manually-written:demo'},
       {'subject':'mathematics','definition':'Mathematics studies quantities, structures, patterns, and relationships.','source':'manually-written:demo'}]


def train_questions(engine,context='knowledge',mode='character',subjects=SUBJECTS):
    return [engine.question_knowledge.learn_questions([{'before':frame.format(subject=s),'after':s,'source':'synthetic:question-target'} for s in subjects],label,context,mode)
            for label,frame in FORMS]


def evaluate():
    e=Engine(database=':memory:')
    try:
        e.question_knowledge.learn_facts(FACTS,'knowledge');runs=[]
        for mode in ('character','byte'):
            learned=train_questions(e,mode=mode);before=e.db.total_changes;cases=[]
            for fact in FACTS:
                assert fact['subject'] not in SUBJECTS
                for label,frame in FORMS:
                    q=frame.format(subject=fact['subject']);r=e.question_knowledge.answer(q,'knowledge',mode)
                    cases.append({'question':q,'expected':fact['definition'],'result':r,'correct':r['status']=='answered' and r['answers'][0]['text']==fact['definition']})
            unknowns=[{'question':q,'result':e.question_knowledge.answer(q,'knowledge',mode)} for q in ('why is chemistry useful?','what is algebra?')]
            assert before==e.db.total_changes
            runs.append({'mode':mode,'training':learned,'cases':cases,'correct':sum(c['correct'] for c in cases),'total':len(cases),'unknowns':unknowns,'inference_writes':0})
        e.question_knowledge.learn_facts([{'subject':'chemistry','definition':'Chemistry is only the study of sound.','source':'synthetic:contradictory-test'}],'knowledge')
        return {'runs':runs,'facts_supplied':FACTS,'contradiction':e.question_knowledge.answer('what is chemistry?','knowledge'),
                'model_calls':0,'scope':'Question subjects held out from pattern training, but their definitions supplied as structured knowledge. Retrieval, not discovery of new facts.'}
    finally:e.close()
if __name__=='__main__':print(json.dumps(evaluate(),indent=2))
