"""Indexed bidirectional text-gap prediction with source-backed context counts.

This is a count-based language experiment, not an LLM or semantic reasoning.
Contexts are indexed shortcuts to preserved observations, not discarded patterns.
"""
import json
import re
from collections import Counter
from pattern_memory import encoded


def tokens(text):return re.findall(r'\w+|[^\w\s]',text.casefold(),re.UNICODE)


class TextGapLearning:
    def __init__(self,engine):
        self.engine=engine;self.db=engine.db
        self.db.executescript('''CREATE TABLE IF NOT EXISTS gap_documents (
          id INTEGER PRIMARY KEY, observation INTEGER NOT NULL, text TEXT NOT NULL,
          source TEXT NOT NULL, context TEXT NOT NULL, window INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS gap_occurrences (
          document INTEGER NOT NULL, position INTEGER NOT NULL, context TEXT NOT NULL,
          left_units TEXT NOT NULL, right_units TEXT NOT NULL, token TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS gap_lookup ON gap_occurrences(context,left_units,right_units);
        CREATE INDEX IF NOT EXISTS gap_document ON gap_documents(context);
        ''')

    def learn(self,text,source,context=None,window=3):
        if not isinstance(text,str) or not text.strip() or len(text)>20000 or '<mask>' in text.casefold():
            raise ValueError('training text must be nonempty, up to 20000 characters, without <mask>')
        if type(window) is not int or not 1<=window<=6:raise ValueError('window must be 1..6')
        if not isinstance(source,str) or not source.strip():raise ValueError('source required')
        words=tokens(text)
        observation=self.engine.patterns.observe_text(text,source,context)['observation']
        with self.db:
            ident=self.db.execute('INSERT INTO gap_documents(observation,text,source,context,window) VALUES (?,?,?,?,?)',
                                  (observation,text,source,encoded(context),window)).lastrowid
            occurrences=[]
            for pos,token in enumerate(words):
                if not token.isalnum():continue
                for left in range(min(pos,window)+1):
                    for right in range(min(len(words)-pos-1,window)+1):
                        occurrences.append((ident,pos,encoded(context),encoded(words[pos-left:pos]),
                                            encoded(words[pos+1:pos+1+right]),token))
            self.db.executemany('INSERT INTO gap_occurrences VALUES (?,?,?,?,?,?)',occurrences)
        return {'document':ident,'observation':observation,'words':sum(x.isalnum() for x in words),
                'indexed_occurrences':len(occurrences),'window':window}

    def vocabulary(self,context=None):
        return Counter({r['token']:r['n'] for r in self.db.execute('''SELECT token,count(*) n FROM gap_occurrences
             WHERE context=? AND left_units='[]' AND right_units='[]' GROUP BY token''',(encoded(context),))})

    def predict(self,text,context=None,window=3,first_word=False):
        if not isinstance(text,str) or text.casefold().count('<mask>')!=1 or len(text)>20000:
            raise ValueError('one <mask> and up to 20000 characters required')
        if type(window) is not int or not 1<=window<=6:raise ValueError('window must be 1..6')
        left,right=text.casefold().split('<mask>');left,right=tokens(left),tokens(right)
        if first_word and (left or not right):raise ValueError('first-word prediction requires <mask> at the beginning and following text')
        document_tokens={}
        evidence=[]
        for a in range(min(len(left),window)+1):
            for b in range(min(len(right),window)+1):
                if a+b==0:continue
                for row in self.db.execute('''SELECT g.*,d.source,d.observation,d.text FROM gap_occurrences g
                    JOIN gap_documents d ON d.id=g.document WHERE g.context=? AND left_units=? AND right_units=?''',
                    (encoded(context),encoded(left[-a:] if a else []),encoded(right[:b]))):
                    if first_word:
                        if row['document'] not in document_tokens:document_tokens[row['document']]=tokens(row['text'])
                        preceding=document_tokens[row['document']][:row['position']]
                        while preceding and preceding[-1] in ('\"', '“', '”', '‘', '’', '\''):preceding.pop()
                        if preceding and preceding[-1] not in ('.','!','?'):continue
                    evidence.append({'token':row['token'],'matched_units':a+b,'left_units':a,'right_units':b,
                                     'document':row['document'],'position':row['position'],'source':row['source'],
                                     'observation':row['observation']})
        candidates=[]
        for token in sorted({r['token'] for r in evidence}):
            rows=[r for r in evidence if r['token']==token];specificity=max(r['matched_units'] for r in rows)
            strongest=[r for r in rows if r['matched_units']==specificity]
            candidates.append({'token':token,'matched_units':specificity,
                               'support':len({(r['document'],r['position']) for r in strongest}),'evidence':strongest})
        candidates.sort(key=lambda c:(-c['matched_units'],-c['support'],c['token']))
        preferred=[c for c in candidates if (c['matched_units'],c['support'])==(candidates[0]['matched_units'],candidates[0]['support'])] if candidates else []
        return {'status':'predicted' if len(preferred)==1 else 'ambiguous' if preferred else 'unknown',
                'preferred':preferred,'candidates':candidates,'verified':False,
                'scope':'Observed word-context counts; case-insensitive, one missing word, no semantic guarantees.'}

    def predict_first(self,following_text,context=None,window=3):
        if not isinstance(following_text,str) or not following_text.strip() or '<mask>' in following_text.casefold():
            raise ValueError('nonempty following text without <mask> required')
        result=self.predict('<mask> '+following_text,context,window,first_word=True)
        result['scope']='Sentence-initial word prediction from observed right contexts; punctuation-based boundaries, no semantic guarantees.'
        return result

    def baseline(self,context=None):
        counts=self.vocabulary(context)
        if not counts:return {'status':'unknown','preferred':[]}
        maximum=max(counts.values())
        return {'status':'predicted' if sum(n==maximum for n in counts.values())==1 else 'ambiguous',
                'preferred':[{'token':word,'support':counts[word]} for word in sorted(counts) if counts[word]==maximum],
                'scope':'Most frequent training word; ignores input context.'}

    def evaluate(self,cases,context=None):
        if not isinstance(cases,list) or not 1<=len(cases)<=1000:raise ValueError('1..1000 held-out cases required')
        training=[tokens(r['text']) for r in self.db.execute('SELECT text FROM gap_documents WHERE context=?',(encoded(context),))]
        prepared=[];seen=set()
        for case in cases:
            if not isinstance(case,dict) or set(case)!={'text','expected'}:raise ValueError('text/expected required')
            expected=case['expected']
            if not isinstance(expected,str) or len(tokens(expected))!=1 or not expected.isalnum():raise ValueError('one expected word required')
            if not isinstance(case['text'],str) or case['text'].casefold().count('<mask>')!=1:raise ValueError('one mask required')
            sentence=case['text'].casefold().replace('<mask>',expected.casefold())
            key=encoded(tokens(sentence))
            sentence_tokens=tokens(sentence)
            if any(any(document[start:start+len(sentence_tokens)]==sentence_tokens for start in range(len(document)-len(sentence_tokens)+1)) for document in training):
                raise ValueError('held-out sentence already appears in training')
            if key in seen:raise ValueError('duplicate held-out sentence')
            seen.add(key);prepared.append(case)
        baseline=self.baseline(context);before=self.db.total_changes;results=[]
        for case in prepared:
            prediction=self.predict(case['text'],context)
            def correct(result):return len(result['preferred'])==1 and result['preferred'][0]['token']==case['expected'].casefold()
            results.append({'text':case['text'],'expected':case['expected'],'status':prediction['status'],
                            'preferred':[x['token'] for x in prediction['preferred']],
                            'correct':correct(prediction),'baseline_correct':correct(baseline),
                            'expected_in_candidates':any(x['token']==case['expected'].casefold() for x in prediction['candidates'])})
        if self.db.total_changes!=before:raise RuntimeError('evaluation mutated memory')
        total=len(results);hits=sum(r['correct'] for r in results);base=sum(r['baseline_correct'] for r in results)
        return {'cases':results,'total':total,'correct':hits,'accuracy':hits/total,'baseline_correct':base,
                'baseline_accuracy':base/total,'baseline':baseline,'learning_updates':0,
                'scope':'Exact word-gap scoring on unseen complete sentences; contexts may overlap training.'}
