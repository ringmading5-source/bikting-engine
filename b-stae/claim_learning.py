"""Supervised sentence-role, mode and polarity alignment; no negation grammar.

Normalization separates final question markers and removes terminal full stops /
exclamation marks. Learned templates, not keyword rules, assign mode/polarity.
"""
import json
from pattern_memory import encoded


def normalize_sentence(text):
    if not isinstance(text,str):raise ValueError('text required')
    text=text.strip()
    if not text:raise ValueError('nonempty sentence required')
    # Only terminal punctuation is handled. Interior punctuation stays intact.
    if text.endswith('?'):
        return text[:-1].rstrip()+' ?'
    return text.rstrip('.!').rstrip()

class ClaimLearning:
    def __init__(self,engine):
        self.engine,self.db=engine,engine.db
        self.db.executescript('''CREATE TABLE IF NOT EXISTS claim_forms
            (context TEXT NOT NULL, mode TEXT NOT NULL, polarity INTEGER NOT NULL,
             PRIMARY KEY(context,mode,polarity));
            CREATE TABLE IF NOT EXISTS claim_observations
            (id INTEGER PRIMARY KEY, context TEXT NOT NULL, original TEXT NOT NULL,
             record TEXT NOT NULL, source TEXT NOT NULL, bridge_example_id INTEGER NOT NULL);''')

    def scope(self,context,mode,polarity):
        return {'claim_learning':context,'mode':mode,'polarity':polarity}

    def learn(self,examples,source,context=None):
        if not isinstance(examples,list) or not 3<=len(examples)<=32:raise ValueError('3..32 aligned claim examples required')
        if not isinstance(source,str) or not 1<=len(source)<=512:raise ValueError('evidence source required')
        labels=set();aligned=[]
        for e in examples:
            if not isinstance(e,dict) or set(e)!={'text','record'}:raise ValueError('text/record required')
            r=e['record']
            if not isinstance(r,dict) or set(r)!={'actor','action','object','mode','polarity'}:
                raise ValueError('roles, mode and polarity required')
            if r['mode'] not in ('assertion','question') or type(r['polarity']) is not bool:
                raise ValueError('assertion/question and boolean polarity required')
            roles={k:r[k] for k in ('actor','action','object')}
            text=normalize_sentence(e['text']);self.engine.roles.validate([{'text':text,'record':roles}])
            labels.add((r['mode'],r['polarity']));aligned.append({'text':text,'record':roles})
        if len(labels)!=1:raise ValueError('batch must share mode and polarity; labels are supplied supervision')
        mode,polarity=next(iter(labels))
        result=self.engine.text_memory.learn(aligned,self.scope(context,mode,polarity))
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO claim_forms VALUES (?,?,?)',(encoded(context),mode,int(polarity)))
            ids=[self.db.execute('INSERT INTO claim_observations(context,original,record,source,bridge_example_id) VALUES (?,?,?,?,?)',
                  (encoded(context),e['text'],encoded(e['record']),source,bridge_id)).lastrowid
                  for e,bridge_id in zip(examples,result['examples'])]
        return {**result,'observations':ids,'mode':mode,'polarity':polarity,'source':source}

    def parse(self,text,context=None,level='byte'):
        normalized=normalize_sentence(text);self.engine.text_memory.validate_text(normalized)
        candidates={};bounded=False
        for form in self.db.execute('SELECT mode,polarity FROM claim_forms WHERE context=? ORDER BY mode,polarity',(encoded(context),)):
            mode,polarity=form['mode'],bool(form['polarity'])
            parsed=self.engine.text_memory.parse(normalized,self.scope(context,mode,polarity),level)
            bounded|=parsed['status']=='bounded'
            for c in parsed['candidates']:
                record={**c['record'],'mode':mode,'polarity':polarity}
                candidate=candidates.setdefault(encoded(record),{'record':record,'evidence':[]})
                candidate['evidence'].extend(c['evidence'])
        provenance=[dict(row) for row in self.db.execute('SELECT id,original,source,bridge_example_id FROM claim_observations WHERE context=?',(encoded(context),))]
        for c in candidates.values():
            ids={ident for evidence in c['evidence'] for ident in evidence.get('examples',[evidence.get('example')])}
            c['source_evidence']=[row for row in provenance if row['bridge_example_id'] in ids]
        status='bounded' if bounded else 'predicted' if len(candidates)==1 else 'ambiguous' if candidates else 'unknown'
        return {'status':status,'candidates':list(candidates.values()),'original':text,'normalized':normalized,
                'operating_level':level,'model_calls':0,'scope':'Supervised local mode/polarity templates; no arbitrary negation scope, quantifiers, tense or event verification.'}

    def inspect(self,text,claim_context=None,context=None,level='byte'):
        parsed=self.parse(text,claim_context,level);readings=[]
        for c in parsed['candidates']:
            r=c['record'];roles={k:r[k] for k in ('actor','action','object')}
            check=self.engine.coherence.check(roles,context)
            base=check['status'];check=dict(check);check.pop('suggested_assertion',None)
            if base in ('supported','conflict'):
                stored=base=='supported';matches=stored==r['polarity']
                if r['mode']=='question':
                    check['status']='answered';check['answer']='yes' if matches else 'no'
                else:
                    check['status']='supported' if matches else 'conflict'
                    if not matches:check['suggested_assertion']={'kind':'capability','subject':r['actor'],
                        'action':r['action'],'object':r['object'],'allowed':stored,'context':context}
            readings.append({'record':r,'language_evidence':c['evidence'],'source_evidence':c['source_evidence'],'coherence':check})
        status=readings[0]['coherence']['status'] if parsed['status']=='predicted' else parsed['status']
        return {'status':status,'parse_status':parsed['status'],'original':text,'normalized':parsed['normalized'],
                'readings':readings,'model_calls':0,'scope':'Answers and corrections are relative to supplied capability evidence, not proof of actual events.'}
