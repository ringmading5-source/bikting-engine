"""Unlabeled positional-frame and repeated-variable induction.

Fits literal positions and equality constraints from raw passages. No question,
answer, relation, or missing-token labels are supplied. Fixed-length alignment
and a bounded frame hypothesis language are programmed, not learned semantics.
"""
import copy
import hashlib
import itertools
import json
from collections import Counter
from text_gap_learning import tokens
from sentence_learning import detokenize
from pattern_memory import encoded


def text_units(text):
    if not isinstance(text,str) or not text.strip() or len(text)>4000 or '<mask>' in text.casefold():
        raise ValueError('nonempty raw passage up to 4000 characters without <mask> required')
    units=tokens(text)
    if not 1<=len(units)<=96:raise ValueError('1..96 tokens per passage required')
    return units


def masked_units(text):
    if not isinstance(text,str) or len(text)>4000 or text.casefold().count('<mask>')!=1:
        raise ValueError('one <mask> within 4000 characters required')
    left,right=text.casefold().split('<mask>')
    units=tokens(left)+[None]+tokens(right)
    if len(units)>96:raise ValueError('up to 96 tokens required')
    return units


class UnlabeledPatternModel:
    def __init__(self,parameters):self.parameters=copy.deepcopy(parameters)

    @classmethod
    def fit(cls,passages):
        if not isinstance(passages,list) or not 3<=len(passages)<=64:raise ValueError('3..64 unlabeled passages required')
        sequences=list({encoded(text_units(text)):text_units(text) for text in passages}.values())
        if len(sequences)<3:raise ValueError('three distinct passages required')
        groups={}
        for sequence in sequences:groups.setdefault(len(sequence),[]).append(sequence)
        frames={};examined=set()
        for length,rows in groups.items():
            for first,second in itertools.combinations(rows,2):
                anchors=[(i,x) for i,x in enumerate(first) if x==second[i]]
                if sum(word.isalnum() for _,word in anchors)<2:continue
                key=encoded([length,anchors])
                if key in examined:continue
                examined.add(key)
                members=[row for row in rows if all(row[i]==word for i,word in anchors)]
                if len(members)<3:continue
                columns=[tuple(row[i] for row in members) for i in range(length)]
                if not any(len(set(column))>=3 for column in columns):continue
                # Columns varying only twice are left unsupported rather than
                # generalized from an accidental pair of examples.
                if any(1<len(set(column))<3 for column in columns):continue
                slots={};pattern=[]
                for column in columns:
                    if len(set(column))==1:pattern.append({'literal':column[0]})
                    else:
                        ident=slots.setdefault(column,len(slots))
                        pattern.append({'slot':ident})
                signature=encoded(pattern)
                frames[signature]={'pattern':pattern,'support':len(members),
                                   'literal_words':sum(p.get('literal','').isalnum() for p in pattern)}
        return cls({'version':1,'frames':[frames[key] for key in sorted(frames)],
                    'unique_passages':len(sequences),'scope':'Fixed-length frames and equal variable positions from unlabeled text.'})

    def export(self):return copy.deepcopy(self.parameters)

    def predict(self,text):
        units=masked_units(text);missing=units.index(None);candidates={};unbound=0
        for frame in self.parameters['frames']:
            pattern=frame['pattern']
            if len(pattern)!=len(units):continue
            bindings={};fits=True
            for part,word in zip(pattern,units):
                if word is None:continue
                if 'literal' in part:
                    if part['literal']!=word:fits=False;break
                else:
                    slot=part['slot']
                    if slot in bindings and bindings[slot]!=word:fits=False;break
                    bindings[slot]=word
            if not fits:continue
            part=pattern[missing];word=part.get('literal') if 'literal' in part else bindings.get(part['slot'])
            if word is None:unbound+=1;continue
            item=candidates.setdefault(word,{'word':word,'evidence':[]})
            item['evidence'].append({'pattern':pattern,'literal_words':frame['literal_words'],'support':frame['support']})
        # Retain every consistent hypothesis: support counts are descriptive,
        # not calibrated certainty and do not erase competing predictions.
        ordered=[candidates[word] for word in sorted(candidates)]
        completed=[]
        for candidate in ordered:
            restored=list(units);restored[missing]=candidate['word']
            completed.append(detokenize(restored))
        return {'status':'predicted' if len(ordered)==1 and not unbound else 'ambiguous' if ordered else 'unknown',
                'candidates':ordered,'completed':completed,'unbound_frames':unbound,'verified':False,
                'training_example_lookups':0,'scope':'Structural completion from fitted frames and equal variable bindings; not semantic inference.'}


class UnlabeledPatterns:
    def __init__(self,engine):
        self.db=engine.db
        self.db.execute('''CREATE TABLE IF NOT EXISTS unlabeled_pattern_models (
            id TEXT PRIMARY KEY, context TEXT NOT NULL, parameters TEXT NOT NULL, training TEXT NOT NULL)''')

    def learn(self,passages,context=None):
        model=UnlabeledPatternModel.fit(passages);parameters=model.export()
        ident=hashlib.sha256(encoded([context,parameters,passages]).encode()).hexdigest()
        with self.db:self.db.execute('INSERT OR IGNORE INTO unlabeled_pattern_models VALUES (?,?,?,?)',
                                     (ident,encoded(context),encoded(parameters),encoded(passages)))
        return {'status':'learned' if parameters['frames'] else 'no_supported_pattern',
                'model_id':ident,'parameters':parameters,'labels_supplied':0}

    def model(self,ident):
        row=self.db.execute('SELECT parameters FROM unlabeled_pattern_models WHERE id=?',(ident,)).fetchone()
        if row is None:raise ValueError('unknown model')
        return UnlabeledPatternModel(json.loads(row['parameters']))

    def predict(self,ident,text):return self.model(ident).predict(text)

    def evaluate(self,ident,cases):
        model=self.model(ident)
        row=self.db.execute('SELECT training FROM unlabeled_pattern_models WHERE id=?',(ident,)).fetchone()
        training=[text_units(text) for text in json.loads(row['training'])]
        if not isinstance(cases,list) or not 1<=len(cases)<=100:raise ValueError('1..100 held-out cases required')
        prepared=[];seen=set();counts=Counter(word for passage in training for word in passage if word.isalnum())
        frequency={word for word,count in counts.items() if count==max(counts.values(),default=0)}
        for case in cases:
            if not isinstance(case,dict) or set(case)!={'text','expected'}:raise ValueError('text/expected required')
            units=masked_units(case['text']);expected=text_units(case['expected'])
            if len(expected)!=1 or not expected[0].isalnum():raise ValueError('one expected word required')
            completed=[expected[0] if word is None else word for word in units];key=encoded(completed)
            if key in seen:raise ValueError('duplicate held-out completion')
            if any(any(document[i:i+len(completed)]==completed for i in range(len(document)-len(completed)+1)) for document in training):
                raise ValueError('completed test passage appears in training')
            seen.add(key);prepared.append((case,units,expected[0]))
        before=self.db.total_changes;results=[]
        for case,units,expected in prepared:
            result=model.predict(case['text'])
            exact={document[units.index(None)] for document in training if len(document)==len(units)
                   and all(word is None or word==observed for word,observed in zip(units,document))}
            correct=result['status']=='predicted' and result['candidates'][0]['word']==expected
            results.append({**case,'status':result['status'],'predicted':[c['word'] for c in result['candidates']],
                            'correct':correct,'exact_baseline_correct':exact=={expected},
                            'frequency_baseline_correct':frequency=={expected},'expected_word_unseen':expected not in counts})
        if self.db.total_changes!=before:raise RuntimeError('evaluation mutated training')
        return {'total':len(results),'correct':sum(r['correct'] for r in results),
                'exact_baseline_correct':sum(r['exact_baseline_correct'] for r in results),
                'frequency_baseline_correct':sum(r['frequency_baseline_correct'] for r in results),
                'cases':results,'learning_updates':0,'scope':'Held-out full passages; equality-pattern transfer only.'}
