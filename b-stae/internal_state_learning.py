"""Supervised internal copying/reordering over learned hierarchical units."""
import json
from pattern_memory import encoded
from text_relationship_learning import infer_pattern,bind,render


def boundary_pattern(sequences):
    """A generic single-variable hypothesis using common outer structure."""
    prefix=0;minimum=min(map(len,sequences))
    while prefix<minimum and all(s[prefix]==sequences[0][prefix] for s in sequences):prefix+=1
    suffix=0
    while suffix<minimum-prefix and all(s[-suffix-1]==sequences[0][-suffix-1] for s in sequences):suffix+=1
    values=[s[prefix:len(s)-suffix if suffix else len(s)] for s in sequences]
    pattern=[{'literal':v} for v in sequences[0][:prefix]]
    slots={}
    if any(values):pattern.append({'slot':0,'min_tokens':0 if any(not v for v in values) else 1});slots[0]=values
    if suffix:pattern.extend({'literal':v} for v in sequences[0][-suffix:])
    return pattern,slots


def linked_templates(inputs,outputs,method):
    infer=boundary_pattern if method=='boundary' else infer_pattern
    pattern,slots=infer(inputs);out,variables=infer(outputs);linked=[]
    for part in pattern:
        if 'slot' in part:part['min_tokens']=min(1,part['min_tokens'])
    for part in out:
        if 'literal' in part:linked.append(part);continue
        matches=[slot for slot,values in slots.items() if values==variables[part['slot']]]
        if len(matches)!=1:return None,False
        linked.append({'slot':matches[0]})
    if len(pattern)>256:return None,True
    for x,y in zip(inputs,outputs):
        matches,limited=bind(pattern,x)
        if limited:return None,True
        if not any(render(linked,b)==y for b in matches):return None,False
    return {'input':pattern,'output':linked},False


class InternalStateLearning:
    def __init__(self,engine):
        self.engine=engine;self.db=engine.db;self.hierarchy=engine.recursive_patterns
        self.db.executescript('''CREATE TABLE IF NOT EXISTS internal_state_examples
          (id INTEGER PRIMARY KEY, context TEXT NOT NULL, mode TEXT NOT NULL, record TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS internal_state_models
          (id INTEGER PRIMARY KEY, context TEXT NOT NULL, mode TEXT NOT NULL, model TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS internal_example_context ON internal_state_examples(context,mode);
          CREATE INDEX IF NOT EXISTS internal_model_context ON internal_state_models(context,mode);''')
        for row in list(self.db.execute('SELECT * FROM internal_state_examples')):
            e=json.loads(row['record']);self.index_example(row['id'],e,json.loads(row['context']),row['mode'])

    def scope(self,context):return ['internal-state',context]

    def index_example(self,ident,e,context,mode):
        self.engine.boundary_states.observe(self.hierarchy.raw(e['before'],mode),{'example_id':ident},e['source'],['internal-evidence',context],mode,ident)

    def learn(self,examples,context=None,mode='character'):
        if not isinstance(examples,list) or not 3<=len(examples)<=32:raise ValueError('3..32 before/after/source pairs required')
        for e in examples:
            if not isinstance(e,dict) or set(e)!={'before','after','source'} or not isinstance(e['source'],str) or not 1<=len(e['source'])<=256:
                raise ValueError('before/after/source required')
            self.hierarchy.raw(e['before'],mode);self.hierarchy.raw(e['after'],mode)
        if len({e['before'] for e in examples})<3:raise ValueError('three distinct inputs required')
        discovery=self.hierarchy.learn([{'text':e[k],'source':e['source']} for e in examples for k in ('before','after')],self.scope(context),mode,rounds=32)
        inputs=[];outputs=[];ids=[]
        with self.db:
            for e in examples:
                before=self.hierarchy.encode(e['before'],self.scope(context),mode);after=self.hierarchy.encode(e['after'],self.scope(context),mode)
                record={**e,'before_state':before,'after_state':after}
                ident=self.db.execute('INSERT INTO internal_state_examples(context,mode,record) VALUES (?,?,?)',(encoded(context),mode,encoded(record))).lastrowid
                self.index_example(ident,e,context,mode);ids.append(ident);inputs.append(before['units']);outputs.append(after['units'])
        retained={'examples':ids,'evidence_retained':True,'discovery':discovery}
        raw_inputs=[self.hierarchy.raw(e['before'],mode) for e in examples]
        raw_outputs=[self.hierarchy.raw(e['after'],mode) for e in examples]
        hypotheses=[];alignment_limited=False
        for encoding,method,xs,ys in [('hierarchy','lcs',inputs,outputs),('base','lcs',raw_inputs,raw_outputs),('base','boundary',raw_inputs,raw_outputs)]:
            if method=='lcs' and any(len(s)>256 for s in xs+ys):alignment_limited=True;continue
            model,bounded=linked_templates(xs,ys,method);alignment_limited|=bounded
            if model is not None:
                model.update(examples=ids,hierarchy_run=discovery['run_id'],encoding=encoding,alignment_method=method)
                hypotheses.append(model)
        if not hypotheses:return {'status':'bounded' if alignment_limited else 'unsupported','reason':'No verified copied-variable alignment found',**retained}
        model_ids=[]
        with self.db:
            for model in hypotheses:model_ids.append(self.db.execute('INSERT INTO internal_state_models(context,mode,model) VALUES (?,?,?)',(encoded(context),mode,encoded(model))).lastrowid)
        return {'status':'learned','model_id':model_ids[0],'model':hypotheses[0],'model_ids':model_ids,
                'models':hypotheses,'alignment_limited':alignment_limited,**retained,
                'scope':'Verified hierarchy/base LCS and common-boundary copying hypotheses; paired targets supplied.'}

    def predict(self,text,context=None,mode='character',strategy='indexed'):
        raw=self.hierarchy.raw(text,mode);outputs={};limited=False;models_tested=0;bindings_tested=0
        def add(output,state,evidence):
            c=outputs.setdefault(output,{'text':output,'state':state,'evidence':[]});c['evidence'].append(evidence)
        retrieval=self.engine.boundary_states.search(raw,['internal-evidence',context],mode,strategy)
        limited|=retrieval['search_limited']
        for match in retrieval['matches']:
            ident=match['payload']['example_id'];row=self.db.execute('SELECT record FROM internal_state_examples WHERE id=?',(ident,)).fetchone()
            e=json.loads(row[0]);add(e['after'],e['after_state']['units'],{'example':ident,'kind':'observed'})
        for row in self.db.execute('SELECT * FROM internal_state_models WHERE context=? AND mode=? ORDER BY id',(encoded(context),mode)):
            model=json.loads(row['model']);packet=self.hierarchy.encode(text,self.scope(context),mode,model['hierarchy_run']);models_tested+=1
            if packet['status']=='unknown':continue
            if model.get('encoding')=='base':
                matches,bounded=bind(model['input'],raw);limited|=bounded;bindings_tested+=len(matches)
                for binding in matches:
                    out_numbers=render(model['output'],binding)
                    try:
                        output=bytes(out_numbers).decode('utf-8') if mode=='byte' else ''.join(chr(n) for n in out_numbers)
                        state=self.hierarchy.encode(output,self.scope(context),mode,model['hierarchy_run'])['units']
                    except (ValueError,UnicodeDecodeError):limited=True;continue
                    add(output,state,{'model_id':row['id'],'examples':model['examples'],'hierarchy_run':model['hierarchy_run'],
                                      'bindings':binding,'kind':'induced','alignment_level':'base-numbers','alignment_method':model['alignment_method']})
                continue
            if len(packet['units'])>256:limited=True;continue
            matches,bounded=bind(model['input'],packet['units']);limited|=bounded;bindings_tested+=len(matches)
            for binding in matches:
                state=render(model['output'],binding)
                try:output=self.hierarchy.decode(state,mode)
                except ValueError:limited=True;continue
                add(output,state,{'model_id':row['id'],'examples':model['examples'],'hierarchy_run':model['hierarchy_run'],'bindings':binding,'kind':'induced'})
            # Verify alternative alignments at the underlying numerical level:
            # a merge can otherwise hide a repeated interior anchor.
            def expand_pattern(pattern):
                result=[]
                for part in pattern:
                    if 'slot' in part:result.append({'slot':part['slot'],'min_tokens':part.get('min_tokens',0)})
                    else:result.extend({'literal':n} for n in self.hierarchy.expand(part['literal'],mode))
                return result
            base_input=expand_pattern(model['input']);base_output=expand_pattern(model['output'])
            if len(base_input)>256:limited=True;continue
            base_matches,bounded=bind(base_input,raw);limited|=bounded;bindings_tested+=len(base_matches)
            for binding in base_matches:
                out_numbers=render(base_output,binding)
                try:
                    output=bytes(out_numbers).decode('utf-8') if mode=='byte' else ''.join(chr(n) for n in out_numbers)
                    state=self.hierarchy.encode(output,self.scope(context),mode,model['hierarchy_run'])['units']
                except (ValueError,UnicodeDecodeError):limited=True;continue
                add(output,state,{'model_id':row['id'],'examples':model['examples'],'hierarchy_run':model['hierarchy_run'],
                                  'bindings':binding,'kind':'induced','alignment_level':'base-numbers'})

        return {'status':'bounded' if limited else 'predicted' if len(outputs)==1 else 'ambiguous' if outputs else 'unknown',
                'candidates':list(outputs.values()),'retrieval':retrieval,'models_tested':models_tested,'bindings_tested':bindings_tested,
                'search_limited':limited,'verified':False,'scope':'Supervised structural rewrite; no world facts or semantic equivalence verified.'}
