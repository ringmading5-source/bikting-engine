"""Multiword and sentence-length gaps using preserved passage contexts.

Candidates are observed contiguous spans, not arbitrary generated sentences.
A sentence_end option uses explicit punctuation boundaries for continuation.
"""
import json
import re
from text_gap_learning import tokens
from pattern_memory import encoded


def detokenize(units):
    text=' '.join(units)
    return re.sub(r'\s+([.,!?;:])',r'\1',text)


class SentenceLearning:
    def __init__(self,engine):self.engine=engine;self.db=engine.db

    def predict(self,text,context=None,window=3,max_tokens=24,sentence_end=False):
        if not isinstance(text,str) or text.casefold().count('<mask>')!=1 or len(text)>20000:
            raise ValueError('one <mask> and up to 20000 characters required')
        if type(window) is not int or not 1<=window<=6:raise ValueError('window must be 1..6')
        if type(max_tokens) is not int or not 1<=max_tokens<=64:raise ValueError('max_tokens must be 1..64')
        if type(sentence_end) is not bool:raise ValueError('sentence_end must be boolean')
        prefix,suffix=text.casefold().split('<mask>');left,right=tokens(prefix),tokens(suffix)
        left,right=left[-window:],right[:window]
        groups={};scanned=0
        for row in self.db.execute('SELECT * FROM gap_documents WHERE context=? ORDER BY id',(encoded(context),)):
            document=tokens(row['text'])
            for start in range(len(document)):
                if not document[start].isalnum():continue
                for end in range(start+1,min(len(document),start+max_tokens)+1):
                    scanned+=1
                    if sentence_end and document[end-1] not in ('.','!','?'):continue
                    if sentence_end and any(t in ('.','!','?') for t in document[start:end-1]):continue
                    a=max((n for n in range(1,min(len(left),start)+1) if document[start-n:start]==left[-n:]),default=0)
                    b=max((n for n in range(1,min(len(right),len(document)-end)+1) if document[end:end+n]==right[:n]),default=0)
                    if a+b==0:continue
                    # If both sides were supplied, prefer actual two-sided fits
                    # through their larger matched-context score, retaining others.
                    span=document[start:end];key=encoded(span)
                    candidate=groups.setdefault(key,{'tokens':span,'text':detokenize(span),'evidence':[]})
                    candidate['evidence'].append({'document':row['id'],'observation':row['observation'],
                                                'source':row['source'],'start':start,'end':end,
                                                'left_units':a,'right_units':b,'matched_units':a+b})
        candidates=list(groups.values())
        for c in candidates:
            c['matched_units']=max(e['matched_units'] for e in c['evidence'])
            c['support']=len({(e['document'],e['start'],e['end']) for e in c['evidence'] if e['matched_units']==c['matched_units']})
        candidates.sort(key=lambda c:(-c['matched_units'],-c['support'],c['text']))
        preferred=[c for c in candidates if (c['matched_units'],c['support'])==(candidates[0]['matched_units'],candidates[0]['support'])] if candidates else []
        return {'status':'predicted' if len(preferred)==1 else 'ambiguous' if preferred else 'unknown',
                'preferred':preferred,'candidates':candidates,'scanned_spans':scanned,'verified':False,
                'scope':'Observed multiword spans selected by local context; not unrestricted sentence generation.'}

    def continue_sentence(self,prefix,context=None,max_tokens=24):
        if not isinstance(prefix,str) or '<mask>' in prefix.casefold():raise ValueError('prefix without mask required')
        prediction=self.predict(prefix+' <mask>',context,max_tokens=max_tokens,sentence_end=True)
        for candidate in prediction['candidates']:
            candidate['completed_sentence']=detokenize(tokens(prefix)+candidate['tokens'])
        return prediction

    def evaluate(self,cases,context=None):
        if not isinstance(cases,list) or not 1<=len(cases)<=1000:raise ValueError('1..1000 cases required')
        training=[tokens(r['text']) for r in self.db.execute('SELECT text FROM gap_documents WHERE context=?',(encoded(context),))]
        validated=[];seen=set()
        for case in cases:
            if not isinstance(case,dict) or set(case)!={'text','expected'}:raise ValueError('text/expected required')
            if not isinstance(case['text'],str) or case['text'].casefold().count('<mask>')!=1 or not isinstance(case['expected'],str) or not tokens(case['expected']):raise ValueError('one mask and nonempty expected span required')
            sentence=tokens(case['text'].casefold().replace('<mask>',case['expected'].casefold()))
            key=encoded(sentence)
            if key in seen:raise ValueError('duplicate held-out completion')
            if any(any(doc[i:i+len(sentence)]==sentence for i in range(len(doc)-len(sentence)+1)) for doc in training):raise ValueError('held-out completion appears in training')
            seen.add(key);validated.append(case)
        before=self.db.total_changes;results=[]
        for case in validated:
            result=self.predict(case['text'],context);expected=tokens(case['expected'])
            results.append({'text':case['text'],'expected':case['expected'],'status':result['status'],
                            'preferred':[c['text'] for c in result['preferred']],
                            'correct':len(result['preferred'])==1 and result['preferred'][0]['tokens']==expected,
                            'expected_in_candidates':any(c['tokens']==expected for c in result['candidates'])})
        if self.db.total_changes!=before:raise RuntimeError('evaluation changed memory')
        correct=sum(c['correct'] for c in results)
        return {'cases':results,'correct':correct,'total':len(results),'accuracy':correct/len(results),
                'learning_updates':0,'scope':'Unseen completed prompts with observed answer spans; not semantic reasoning.'}
