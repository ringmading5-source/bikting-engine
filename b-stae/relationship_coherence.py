"""Bounded, evidence-relative coherence. Supplied assertions are not world truth.

No domain facts are built in. Membership edges retrieve applicable capability
assertions; contextual and more specific evidence can override general defaults.
Equal-specificity opposing evidence stays contested. Revisions preserve history.
"""
import json
from pattern_memory import encoded

class RelationshipCoherence:
    def __init__(self, engine):
        self.engine, self.db = engine, engine.db
        self.db.execute('''CREATE TABLE IF NOT EXISTS coherence_evidence
            (id INTEGER PRIMARY KEY, assertion TEXT NOT NULL, source TEXT NOT NULL,
             supersedes INTEGER UNIQUE REFERENCES coherence_evidence(id))''')

    def observe(self, assertion, source, supersedes=None):
        if not isinstance(assertion, dict): raise ValueError('structured assertion required')
        kind = assertion.get('kind')
        fields = {'kind','subject','class','context'} if kind == 'membership' else {'kind','subject','action','object','allowed','context'}
        if kind not in ('membership','capability') or set(assertion) != fields:
            raise ValueError('membership or capability assertion with explicit context required')
        for field in fields - {'allowed','context'}:
            if not isinstance(assertion[field], str) or not 1 <= len(assertion[field]) <= 128:
                raise ValueError('bounded string labels required')
        if assertion['context'] is not None and (not isinstance(assertion['context'],str) or not 1 <= len(assertion['context']) <= 128):
            raise ValueError('context must be null or a bounded string')
        if kind == 'capability' and type(assertion['allowed']) is not bool:
            raise ValueError('allowed must be boolean')
        if not isinstance(source,str) or not 1 <= len(source) <= 512:
            raise ValueError('evidence source required')
        if supersedes is not None:
            if type(supersedes) is not int: raise ValueError('integer revision ID required')
            previous = self.db.execute('SELECT assertion FROM coherence_evidence WHERE id=?',(supersedes,)).fetchone()
            if previous is None: raise ValueError('unknown revision ID')
            old = json.loads(previous['assertion'])
            if {k:v for k,v in old.items() if k != 'allowed'} != {k:v for k,v in assertion.items() if k != 'allowed'}:
                raise ValueError('revision must concern the same assertion and context')
            if self.db.execute('SELECT id FROM coherence_evidence WHERE supersedes=?',(supersedes,)).fetchone():
                raise ValueError('revise the latest evidence ID')
        with self.db:
            ident = self.db.execute('INSERT INTO coherence_evidence(assertion,source,supersedes) VALUES (?,?,?)',
                                    (encoded(assertion),source,supersedes)).lastrowid
        return {'status':'recorded','id':ident,'supersedes':supersedes,'history_retained':True}

    def check(self, record, context=None):
        self.engine.roles.validate([{'text':'check','record':record}])
        if context is not None and (not isinstance(context,str) or not 1 <= len(context) <= 128):
            raise ValueError('bounded context required')
        rows = self.db.execute('''SELECT * FROM coherence_evidence e WHERE NOT EXISTS
            (SELECT 1 FROM coherence_evidence newer WHERE newer.supersedes=e.id)
            ORDER BY id LIMIT 513''').fetchall()
        if len(rows)>512: return {'status':'bounded','reason':'evidence budget exceeded','model_calls':0}
        evidence = [dict(id=r['id'], assertion=json.loads(r['assertion']), source=r['source']) for r in rows]
        evidence = [e for e in evidence if e['assertion']['context'] is None or e['assertion']['context']==context]
        paths = {record['actor']:[]}
        queue = [record['actor']]
        for subject in queue:
            for e in evidence:
                a=e['assertion']
                if a['kind']=='membership' and a['subject']==subject and a['class'] not in paths:
                    if len(paths)>=128:return {'status':'bounded','reason':'membership budget exceeded','model_calls':0}
                    paths[a['class']]=paths[subject]+[e];queue.append(a['class'])
        applicable=[]
        for e in evidence:
            a=e['assertion']
            if a['kind']!='capability' or a['subject'] not in paths or a['action']!=record['action'] or a['object'] not in (record['object'],'*'):continue
            # Context, nearer subject, then exact object determine default specificity.
            rank=(int(a['context'] is not None),-len(paths[a['subject']]),int(a['object']!='*'))
            applicable.append({**e,'rank':rank,'membership_path':paths[a['subject']]})
        if not applicable:return {'status':'unknown','missing':'applicable capability evidence','record':record,'model_calls':0}
        best=max(e['rank'] for e in applicable)
        deciding=[e for e in applicable if e['rank']==best]
        polarities={e['assertion']['allowed'] for e in deciding}
        status='contested' if len(polarities)>1 else 'supported' if True in polarities else 'conflict'
        result={'status':status,'record':record,'context':context,'deciding_evidence':deciding,
                'overridden_evidence':[e for e in applicable if e['rank']!=best], 'model_calls':0,
                'verification_scope':'consistency with supplied active evidence; not real-world verification'}
        if status=='conflict':result['suggested_assertion']={'kind':'capability','subject':record['actor'],
            'action':record['action'],'object':record['object'],'allowed':False,'context':context}
        return result

    def inspect(self, text, role_context=None, context=None, level='byte'):
        # Once labeled claim forms exist, never fall back to polarity-blind roles.
        if self.db.execute('SELECT 1 FROM claim_forms WHERE context=? LIMIT 1',(encoded(role_context),)).fetchone():
            return self.engine.claims.inspect(text,role_context,context,level)
        parsed=self.engine.roles.parse(text,role_context,level)
        readings=[{'record':c['record'],'role_evidence':c['evidence'],
                   'coherence':self.check(c['record'],context)} for c in parsed['candidates']]
        status=readings[0]['coherence']['status'] if parsed['status']=='predicted' else parsed['status']
        return {'status':status,'role_status':parsed['status'],'readings':readings,'model_calls':0,
                'automatic_rewrite':False}
