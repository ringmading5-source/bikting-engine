"""Experimental meaning as labeled state associations and learned consequences."""
from pattern_memory import encoded


class MeaningMemory:
    def __init__(self,engine):
        self.engine=engine;self.db=engine.db
        self.db.execute('''CREATE TABLE IF NOT EXISTS meaning_actions
          (context TEXT NOT NULL, action TEXT NOT NULL, numeric_sentence_id INTEGER NOT NULL,
           PRIMARY KEY(context,action))''')

    def scope(self,context,kind,action=None):return ['meaning',context,kind,action]

    def learn_expressions(self,examples,context=None):
        return self.engine.text_memory.learn(examples,self.scope(context,'expressions'))

    def learn_relations(self,examples,context=None):
        return self.engine.memory_logic.learn(examples,self.scope(context,'relations'))

    def learn_changes(self,examples,action,context=None):
        if not isinstance(action,str) or not action.strip() or len(action)>128:raise ValueError('bounded action label required')
        result=self.engine.memory_logic.learn(examples,self.scope(context,'changes',action))
        packet=self.engine.numeric_text.encode(action)
        with self.db:self.db.execute('INSERT OR IGNORE INTO meaning_actions VALUES (?,?,?)',
                                     (encoded(context),action,packet['sentence_id']))
        return result

    def inspect(self,text,context=None,level='byte'):
        parsed=self.engine.text_memory.parse(text,self.scope(context,'expressions'),level)
        readings=[]
        for candidate in parsed['candidates']:
            record=candidate['record']
            relations=self.engine.memory_logic.predict(record,self.scope(context,'relations'))
            changes=[]
            for row in self.db.execute('SELECT * FROM meaning_actions WHERE context=? ORDER BY action',(encoded(context),)):
                prediction=self.engine.memory_logic.predict(record,self.scope(context,'changes',row['action']))
                changes.append({'action':row['action'],'action_id':row['numeric_sentence_id'],'prediction':prediction})
            readings.append({'record':record,'evidence':candidate['evidence'],'relationships':relations,'predicted_changes':changes})
        return {'status':parsed['status'],'readings':readings,'operating_level':level,'input_numbers':parsed['input_numbers'],'verified':False,
                'scope':'Labeled expression associations and bounded learned state transformations; no raw-text semantic discovery or real-world action verification.'}

    def read_field(self,text,field,context=None):
        if not isinstance(field,str) or not field or len(field)>64:raise ValueError('bounded field name required')
        inspection=self.inspect(text,context);values={};limited=inspection['status']=='bounded'
        for reading in inspection['readings']:
            records=[reading['record']]+[c['record'] for c in reading['relationships']['candidates']]
            limited|=reading['relationships']['search_limited']
            for record in records:
                if field in record:values[encoded(record[field])]=record[field]
        return {'status':'bounded' if limited else 'answered' if len(values)==1 else 'ambiguous' if values else 'unknown',
                'values':list(values.values()),'field':field,'evidence':inspection,'verified':False}

    def run(self,text,context=None,action=None,level='byte'):
        if action is not None and (not isinstance(action,str) or not action or len(action)>128):
            raise ValueError('bounded action label required')
        inspection=self.inspect(text,context,level);outcomes={};limited=inspection['status']=='bounded'
        for reading in inspection['readings']:
            if action is None:
                candidates=[{'record':reading['record'],'evidence':reading['evidence']}]
            else:
                matches=[x for x in reading['predicted_changes'] if x['action']==action]
                candidates=[]
                for match in matches:
                    limited|=match['prediction']['search_limited']
                    candidates.extend(match['prediction']['candidates'])
            for candidate in candidates:
                record=candidate['record'];key=encoded(record)
                if key not in outcomes:
                    outcomes[key]={'record':record,'expressions':self.engine.text_memory.express(record,self.scope(context,'expressions'),level),
                                   'relationships':self.engine.memory_logic.predict(record,self.scope(context,'relations')),'evidence':[]}
                outcomes[key]['evidence'].extend(candidate['evidence'])
                limited|=outcomes[key]['expressions']['search_limited'] or outcomes[key]['relationships']['search_limited']
        return {'status':'bounded' if limited else 'predicted' if len(outcomes)==1 else 'ambiguous' if outcomes else 'unknown',
                'action':action,'input':inspection,'outcomes':list(outcomes.values()),'operating_level':level,
                'search_limited':limited,'verified':False,'executed':False,
                'scope':'Read-only symbolic prediction through numerical sequence models; supplied boundaries and labels, no physical action execution.'}
