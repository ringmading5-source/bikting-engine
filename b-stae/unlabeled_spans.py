"""Variable-length repeated-span induction from unlabeled coherent passages.

Sequence alignment supplies a bounded hypothesis language. Learned literals
and repeated slot links are fitted from examples without completion labels.
"""
import copy
import hashlib
import json
from collections import Counter
from unlabeled_patterns import text_units, masked_units
from text_relationship_learning import infer_pattern, bind
from sentence_learning import detokenize
from text_gap_learning import tokens
from pattern_memory import encoded


class UnlabeledSpanModel:
    def __init__(self,parameters):self.parameters=copy.deepcopy(parameters)
    def export(self):return copy.deepcopy(self.parameters)

    @classmethod
    def fit(cls,passages):
        if not isinstance(passages,list) or not 3<=len(passages)<=32:raise ValueError('3..32 raw passages required')
        sequences=list({encoded(text_units(text)):text_units(text) for text in passages}.values())
        if len(sequences)<3:raise ValueError('three distinct passages required')
        pattern,values=infer_pattern(sequences)
        aliases={slot:next(other for other,column in values.items() if column==rows) for slot,rows in values.items()}
        pattern=[dict(part,slot=aliases[part['slot']]) if 'slot' in part else part for part in pattern]
        repeated=Counter(part['slot'] for part in pattern if 'slot' in part)
        supported=(sum(p.get('literal','').isalnum() for p in pattern)>=2 and any(n>1 for n in repeated.values())
                   and all(len({encoded(v) for v in rows})>=3 for rows in values.values()))
        if supported:
            for sequence in sequences:
                matches,limited=bind(pattern,sequence)
                if not matches or limited:supported=False;break
        return cls({'version':1,'patterns':[pattern] if supported else [],'unique_passages':len(sequences),
                    'scope':'Aligned literal anchors and repeated variable spans; no semantic labels.'})

    def predict(self,text,max_expansions=10000,max_solutions=32):
        if type(max_expansions) is not int or not 1<=max_expansions<=10000:raise ValueError('expansion budget 1..10000 required')
        if type(max_solutions) is not int or not 1<=max_solutions<=32:raise ValueError('solution budget 1..32 required')
        units=masked_units(text);candidates={};limited=False;expanded=0;solutions=0;unbound=0
        for pattern in self.parameters['patterns']:
            def visit(index,offset,bindings,hole):
                nonlocal limited,expanded,solutions,unbound
                if limited:return
                if expanded>=max_expansions or solutions>=max_solutions:limited=True;return
                expanded+=1
                if index==len(pattern):
                    if offset!=len(units) or hole is None:return
                    solutions+=1
                    value=[hole['literal']] if 'literal' in hole else bindings.get(hole['slot'])
                    if not value:unbound+=1;return
                    label=detokenize(value)
                    candidates.setdefault(label,{'text':label,'tokens':value,'evidence':[]})['evidence'].append(
                        {'pattern':pattern,'bindings':bindings})
                    return
                part=pattern[index]
                if offset<len(units) and units[offset] is None:
                    visit(index+1,offset+1,bindings,part)
                if 'literal' in part:
                    if offset<len(units) and units[offset]==part['literal']:visit(index+1,offset+1,bindings,hole)
                    return
                for end in range(offset+part.get('min_tokens',0),len(units)+1):
                    if limited:return
                    value=units[offset:end]
                    if None in value:break
                    if any(unit in part.get('forbidden_tokens',[]) for unit in value):continue
                    slot=part['slot']
                    if slot in bindings and bindings[slot]!=value:continue
                    visit(index+1,end,{**bindings,slot:value},hole)
            visit(0,0,{},None)
        ordered=[candidates[key] for key in sorted(candidates)]
        before,after=text.casefold().split('<mask>')
        return {'status':'bounded' if limited else 'predicted' if len(ordered)==1 and not unbound else 'ambiguous' if ordered else 'unknown',
                'candidates':ordered,'completed':[detokenize(tokens(before)+c['tokens']+tokens(after)) for c in ordered],
                'unbound_solutions':unbound,'expansions':expanded,'search_limited':limited,
                'training_example_lookups':0,'verified':False,
                'scope':'One mask stands for one complete learned span or literal; variable-length structural copying, not meaning.'}


class UnlabeledSpanLearning:
    def __init__(self,engine):
        self.db=engine.db
        self.db.execute('''CREATE TABLE IF NOT EXISTS unlabeled_span_models (
            id TEXT PRIMARY KEY, context TEXT NOT NULL, parameters TEXT NOT NULL, training TEXT NOT NULL)''')

    def learn(self,passages,context=None):
        parameters=UnlabeledSpanModel.fit(passages).export()
        ident=hashlib.sha256(encoded([context,parameters,passages]).encode()).hexdigest()
        with self.db:self.db.execute('INSERT OR IGNORE INTO unlabeled_span_models VALUES (?,?,?,?)',
            (ident,encoded(context),encoded(parameters),encoded(passages)))
        return {'status':'learned' if parameters['patterns'] else 'no_supported_pattern',
                'model_id':ident,'parameters':parameters,'labels_supplied':0}

    def model(self,ident):
        row=self.db.execute('SELECT parameters FROM unlabeled_span_models WHERE id=?',(ident,)).fetchone()
        if row is None:raise ValueError('unknown span model')
        return UnlabeledSpanModel(json.loads(row['parameters']))

    def predict(self,ident,text,max_expansions=10000):return self.model(ident).predict(text,max_expansions=max_expansions)

    def evaluate(self,ident,cases):
        model=self.model(ident)
        row=self.db.execute('SELECT training FROM unlabeled_span_models WHERE id=?',(ident,)).fetchone()
        training=[text_units(text) for text in json.loads(row['training'])]
        if not isinstance(cases,list) or not 1<=len(cases)<=100:raise ValueError('1..100 held-out cases required')
        counts=Counter(word for passage in training for word in passage if word.isalnum())
        frequent={word for word,n in counts.items() if n==max(counts.values(),default=0)}
        prepared=[];seen=set()
        for case in cases:
            if not isinstance(case,dict) or set(case)!={'text','expected'}:raise ValueError('text/expected required')
            units=masked_units(case['text']);expected=text_units(case['expected']);mask=units.index(None)
            complete=units[:mask]+expected+units[mask+1:];key=encoded(complete)
            if key in seen:raise ValueError('duplicate held-out completion')
            if any(any(p[i:i+len(complete)]==complete for i in range(len(p)-len(complete)+1)) for p in training):
                raise ValueError('completed passage appears in training')
            seen.add(key);prepared.append((case,units,expected,mask))
        before=self.db.total_changes;results=[]
        for case,units,expected,mask in prepared:
            result=model.predict(case['text']);exact=set();suffix=units[mask+1:]
            for passage in training:
                size=len(passage)-(len(units)-1)
                if size<=0:continue
                if passage[:mask]==units[:mask] and passage[mask+size:]==suffix:exact.add(encoded(passage[mask:mask+size]))
            results.append({**case,'status':result['status'],'predicted':[c['text'] for c in result['candidates']],
                'correct':result['status']=='predicted' and result['candidates'][0]['tokens']==expected,
                'exact_baseline_correct':exact=={encoded(expected)},
                'frequency_baseline_correct':len(expected)==1 and frequent=={expected[0]},
                'unseen_word_count':sum(word not in counts for word in expected if word.isalnum())})
        if self.db.total_changes!=before:raise RuntimeError('evaluation mutated learning')
        return {'total':len(results),'correct':sum(r['correct'] for r in results),
                'exact_baseline_correct':sum(r['exact_baseline_correct'] for r in results),
                'frequency_baseline_correct':sum(r['frequency_baseline_correct'] for r in results),
                'cases':results,'learning_updates':0,'scope':'Held-out repeated-span completions; structural generalization only.'}
