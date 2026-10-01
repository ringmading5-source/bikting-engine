"""Example-trained lexical task routing; no installed command-word mapping.

This is a discriminative n-gram evidence model, not general language reasoning.
All conflicting labeled requests remain in memory. Context labels are supplied.
"""
import json
import re
from collections import Counter, defaultdict
from pattern_memory import encoded


def features(text):
    words=re.findall(r'\w+',text.casefold())
    return set(words)|{' '.join(words[i:i+2]) for i in range(len(words)-1)}


class LearnedRequestRouter:
    def __init__(self,engine):
        self.db=engine.db;self.engine=engine
        self.db.execute('''CREATE TABLE IF NOT EXISTS pattern_request_examples (
          id INTEGER PRIMARY KEY, text TEXT NOT NULL, context TEXT NOT NULL, source TEXT NOT NULL)''')

    def learn(self,text,context,source):
        if not isinstance(text,str) or not text.strip() or len(text)>2000 or not features(text):
            raise ValueError('nonempty request of up to 2000 characters required')
        if not isinstance(source,str) or not source.strip():raise ValueError('source required')
        with self.db:
            ident=self.db.execute('INSERT INTO pattern_request_examples(text,context,source) VALUES (?,?,?)',
                                  (text,encoded(context),source)).lastrowid
        self.engine.patterns.observe_text(text,source,context)
        return {'example':ident,'context':context,'scope':'Supplied context label, stored request patterns.'}

    def route(self,text):
        if not isinstance(text,str) or not 1<=len(text)<=2000:raise ValueError('bounded request text required')
        query=features(text);groups=defaultdict(list); owners=defaultdict(set)
        for row in self.db.execute('SELECT * FROM pattern_request_examples ORDER BY id'):
            feats=features(row['text']);groups[row['context']].append((row,feats))
            for feature in feats:owners[feature].add(row['context'])
        candidates=[]
        for context,examples in groups.items():
            # Shared words carry no distinguishing evidence; do not force a route.
            distinguishing={f for f in query if owners[f]=={context}}
            evidence=[{'example':r['id'],'source':r['source'],'matched':sorted(query & fs)}
                      for r,fs in examples if query & fs]
            if not evidence:continue
            counts=Counter(f for r,fs in examples for f in fs)
            score=sum((2 if ' ' in f else 1)*min(counts[f],3) for f in distinguishing)
            candidates.append({'context':json.loads(context),'score':score,
                               'distinguishing':sorted(distinguishing),'evidence':evidence})
        candidates.sort(key=lambda c:(-c['score'],encoded(c['context'])))
        preferred=[c for c in candidates if c['score']==candidates[0]['score']] if candidates else []
        return {'status':'routed' if len(preferred)==1 else 'ambiguous' if preferred else 'unknown',
                'preferred':preferred,'candidates':candidates,'verified':False,
                'scope':'Learned lexical associations; unknown wording may require labeled examples.'}
