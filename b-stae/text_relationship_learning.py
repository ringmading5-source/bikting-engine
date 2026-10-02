"""Learn linked statement/question/answer templates from labeled examples.

LCS anchors and variable bindings form the programmed hypothesis language.
No drinks/teach/what grammar is installed. This is supervised template induction,
not discovering semantics from arbitrary raw text.
"""
import json
import hashlib
from text_gap_learning import tokens
from sentence_learning import detokenize
from pattern_memory import encoded


def common(a,b):
    # Generic sequence alignment, bounded by the input validation below.
    matrix=[[0]*(len(b)+1) for _ in range(len(a)+1)]
    for i in range(len(a)-1,-1,-1):
        for j in range(len(b)-1,-1,-1):
            matrix[i][j]=1+matrix[i+1][j+1] if a[i]==b[j] else max(matrix[i+1][j],matrix[i][j+1])
    i=j=0;out=[]
    while i<len(a) and j<len(b):
        if a[i]==b[j]:out.append(a[i]);i+=1;j+=1
        elif matrix[i+1][j]>=matrix[i][j+1]:i+=1
        else:j+=1
    return out


def split(units,anchors):
    gaps=[];offset=0
    for anchor in anchors:
        try:index=units.index(anchor,offset)
        except ValueError:return None
        gaps.append(units[offset:index]);offset=index+1
    gaps.append(units[offset:]);return gaps


def infer_pattern(sequences):
    anchors=sequences[0]
    for sequence in sequences[1:]:anchors=common(anchors,sequence)
    gaps=[split(sequence,anchors) for sequence in sequences]
    pattern=[];slot_values={};slot=0
    for position in range(len(anchors)+1):
        values=[parts[position] for parts in gaps]
        if any(values):
            if all(v==values[0] for v in values):pattern.extend({'literal':v} for v in values[0])
            else:
                pattern.append({'slot':slot,'min_tokens':min(len(v) for v in values)});slot_values[slot]=values;slot+=1
        if position<len(anchors):pattern.append({'literal':anchors[position]})
    return pattern,slot_values


def bind(pattern,units,max_bindings=32):
    solutions=[];limited=False;expansions=0
    def visit(index,offset,values):
        nonlocal limited,expansions
        if limited:return
        expansions+=1
        if expansions>10000 or len(solutions)>=max_bindings:limited=True;return
        if index==len(pattern):
            if offset==len(units):solutions.append(values)
            return
        part=pattern[index]
        if 'literal' in part:
            if offset<len(units) and units[offset]==part['literal']:visit(index+1,offset+1,values)
        else:
            for end in range(offset+part.get('min_tokens',0),len(units)+1):
                if limited:break
                value=units[offset:end];slot=part['slot']
                if slot in values and values[slot]!=value:continue
                visit(index+1,end,{**values,slot:value})
    visit(0,0,{})
    return solutions,limited


def render(pattern,bindings):
    result=[]
    for part in pattern:
        if 'literal' in part:result.append(part['literal'])
        else:
            if part['slot'] not in bindings:return None
            result.extend(bindings[part['slot']])
    return result


class TextRelationshipLearning:
    def __init__(self,engine):
        self.engine=engine;self.db=engine.db
        self.db.executescript('''CREATE TABLE IF NOT EXISTS text_relation_examples (
           id INTEGER PRIMARY KEY, context TEXT NOT NULL, record TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS text_relation_models (
           id TEXT PRIMARY KEY, context TEXT NOT NULL, model TEXT NOT NULL);
        ''')

    def learn(self,examples,context=None):
        if not isinstance(examples,list) or not 3<=len(examples)<=32:raise ValueError('3..32 labeled examples required')
        for example in examples:
            if not isinstance(example,dict) or set(example)!={'statement','question','answer','source'}:raise ValueError('statement/question/answer/source required')
            for key in ('statement','question','answer','source'):
                if not isinstance(example[key],str) or not example[key].strip() or len(example[key])>2000:raise ValueError('bounded nonempty fields required')
            if any(len(tokens(example[key]))>64 for key in ('statement','question','answer')):raise ValueError('up to 64 tokens per field')
        inputs=[tokens(e['statement']) for e in examples]
        if len({encoded(x) for x in inputs})<3:raise ValueError('three distinct statements required')
        statement,slots=infer_pattern(inputs)
        outputs={};unsupported=[]
        for field in ('question','answer'):
            pattern,variables=infer_pattern([tokens(e[field]) for e in examples]);linked=[]
            for part in pattern:
                if 'literal' in part:linked.append(part);continue
                values=variables[part['slot']]
                matches=[slot for slot,source_values in slots.items() if source_values==values]
                if len(matches)!=1:unsupported.append(field);break
                linked.append({'slot':matches[0]})
            else:outputs[field]=linked
        # Preserve every example, even when this hypothesis language cannot fit it.
        ids=[]
        for example in examples:
            self.engine.patterns.observe_text(example['statement'],example['source'],context)
            with self.db:ids.append(self.db.execute('INSERT INTO text_relation_examples(context,record) VALUES (?,?)',
                                                    (encoded(context),encoded(example))).lastrowid)
        if unsupported:return {'status':'unsupported_relationship','fields':sorted(set(unsupported)),'examples':ids,'evidence_retained':True}
        model={'statement':statement,**outputs,'examples':ids,'sources':[e['source'] for e in examples]}
        # Verify the linked templates reproduce all training outputs.
        for example,units in zip(examples,inputs):
            matches,limited=bind(statement,units)
            if limited or not any(all(render(outputs[field],binding)==tokens(example[field]) for field in outputs) for binding in matches):
                return {'status':'unsupported_relationship','examples':ids,'evidence_retained':True}
        ident=hashlib.sha256(encoded([context,model]).encode()).hexdigest()
        with self.db:self.db.execute('INSERT INTO text_relation_models VALUES (?,?,?)',(ident,encoded(context),encoded(model)))
        return {'status':'learned','model_id':ident,'model':model,'scope':'Supervised linked text templates, not raw-text semantic learning.'}

    def models(self,context):
        return [(r['id'],json.loads(r['model'])) for r in self.db.execute('SELECT * FROM text_relation_models WHERE context=? ORDER BY id',(encoded(context),))]

    def transform(self,statement,context=None):
        if not isinstance(statement,str) or len(tokens(statement))>64:raise ValueError('statement up to 64 tokens required')
        candidates={};limited=False
        for ident,model in self.models(context):
            bindings,bounded=bind(model['statement'],tokens(statement));limited|=bounded
            for values in bindings:
                question=render(model['question'],values);answer=render(model['answer'],values)
                if question is None or answer is None:continue
                key=encoded([question,answer]);candidate=candidates.setdefault(key,{'question':detokenize(question),'answer':detokenize(answer),'evidence':[]})
                candidate['evidence'].append({'model_id':ident,'examples':model['examples'],'bindings':values})
        return {'status':'bounded' if limited else 'transformed' if len(candidates)==1 else 'ambiguous' if candidates else 'unknown',
                'candidates':list(candidates.values()),'search_limited':limited,'verified':False}

    def answer(self,statement,question,context=None):
        if not isinstance(question,str) or len(tokens(question))>64:raise ValueError('question up to 64 tokens required')
        result=self.transform(statement,context)
        candidates=[c for c in result['candidates'] if tokens(c['question'])==tokens(question)]
        return {'status':'bounded' if result['search_limited'] else 'answered' if len(candidates)==1 else 'ambiguous' if candidates else 'unknown',
                'candidates':candidates,'verified':False,'scope':'Binding a learned question template to a supplied statement; no general QA.'}
