"""Learned question-to-subject patterns followed by sourced definition retrieval.

Knowledge records and canonical question targets are supplied. This does not
learn facts from arbitrary raw passages or invent answers for unknown subjects.
"""
from pattern_memory import encoded


class QuestionKnowledge:
    def __init__(self,engine):
        self.engine=engine;self.db=engine.db
        self.db.execute('''CREATE TABLE IF NOT EXISTS knowledge_question_patterns
          (context TEXT NOT NULL, mode TEXT NOT NULL, label TEXT NOT NULL,
           PRIMARY KEY(context,mode,label))''')

    def normalize(self,text):
        if not isinstance(text,str) or not text.strip():raise ValueError('nonempty text required')
        value=text.strip().casefold()
        value.encode('utf-8')
        return value

    def pattern_context(self,context,label):return ['knowledge-question',context,label]

    def learn_questions(self,examples,label,context=None,mode='character'):
        if not isinstance(label,str) or not 1<=len(label)<=128:raise ValueError('bounded pattern label required')
        if not isinstance(examples,list):raise ValueError('paired examples required')
        normalized=[]
        for e in examples:
            if not isinstance(e,dict) or set(e)!={'before','after','source'}:raise ValueError('before/after/source required')
            normalized.append({'before':self.normalize(e['before']),'after':self.normalize(e['after']),'source':e['source']})
        result=self.engine.internal_states.learn(normalized,self.pattern_context(context,label),mode)
        with self.db:self.db.execute('INSERT OR IGNORE INTO knowledge_question_patterns VALUES (?,?,?)',(encoded(context),mode,label))
        return result

    def learn_facts(self,facts,context=None):
        if not isinstance(facts,list) or not 1<=len(facts)<=10000:raise ValueError('1..10000 fact records required')
        normalized=[]
        for fact in facts:
            if not isinstance(fact,dict) or set(fact)!={'subject','definition','source'}:raise ValueError('subject/definition/source required')
            subject=self.normalize(fact['subject'])
            if len(subject)>128 or not isinstance(fact['definition'],str) or not 1<=len(fact['definition'])<=512 or not isinstance(fact['source'],str) or not 1<=len(fact['source'])<=256:
                raise ValueError('bounded subject, definition and source required')
            fact['definition'].encode('utf-8');fact['source'].encode('utf-8')
            normalized.append({**fact,'subject':subject})
        ids=[]
        for fact in normalized:
            representation=self.engine.numeric_text.encode(fact['definition'])
            payload={**fact,'definition_sentence_id':representation['sentence_id']}
            ids.append(self.engine.boundary_states.observe([ord(c) for c in fact['subject']],payload,fact['source'],['question-facts',context]))
        return {'status':'stored','observations':len(ids),'state_ids':ids,'scope':'Supplied definition records; no independent truth verification.'}

    def answer(self,question,context=None,mode='character'):
        question=self.normalize(question);self.engine.recursive_patterns.raw(question,mode)
        interpretations=[];subjects={};answers={};limited=False;ambiguous=False;lookups=[]
        for row in self.db.execute('SELECT * FROM knowledge_question_patterns WHERE context=? AND mode=? ORDER BY label',(encoded(context),mode)):
            prediction=self.engine.internal_states.predict(question,self.pattern_context(context,row['label']),mode)
            limited|=prediction['search_limited'];ambiguous|=prediction['status']=='ambiguous'
            for candidate in prediction['candidates']:
                subject=self.normalize(candidate['text'])
                interpretations.append({'label':row['label'],'subject':subject,'evidence':candidate['evidence']})
                if len(subject)>128:limited=True;continue
                subjects[subject]=True
        for subject in subjects:
            retrieval=self.engine.boundary_states.search([ord(c) for c in subject],['question-facts',context])
            limited|=retrieval['search_limited'];lookups.append({'subject':subject,'retrieval':retrieval})
            for match in retrieval['matches']:
                fact=match['payload'];definition=self.engine.numeric_text.decode(fact['definition_sentence_id'])['text']
                answer=answers.setdefault(encoded([subject,definition]),{'subject':subject,'text':definition,'sources':[]})
                answer['sources'].append({'source':fact['source'],'state_id':match['id'],'definition_sentence_id':fact['definition_sentence_id']})
        ambiguous|=len(subjects)>1
        status='bounded' if limited else 'ambiguous' if answers and (ambiguous or len(answers)>1) else 'answered' if answers else 'unknown'
        return {'status':status,'answers':list(answers.values()),'interpretations':interpretations,'knowledge_lookups':lookups,
                'reason':None if answers else 'No stored definition for extracted subject' if subjects else 'No applicable learned question pattern',
                'search_limited':limited,'verified':False,
                'scope':'Learned request pattern plus exact sourced definition retrieval; not raw-text knowledge discovery or unrestricted question answering.'}
