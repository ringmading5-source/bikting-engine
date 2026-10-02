"""Learn whole-state concatenation transformations and compose bounded paths.

Paired targets supply the desired changes. No sentence frame or word boundary
is installed; this hypothesis language copies a complete state and surrounds
it with observed literal states. It is not semantic or causal discovery.
"""
import json
from pattern_memory import encoded


class ComposedStateLearning:
    def __init__(self,engine):
        self.engine=engine;self.db=engine.db;self.hierarchy=engine.recursive_patterns
        self.db.executescript('''CREATE TABLE IF NOT EXISTS composed_examples
          (id INTEGER PRIMARY KEY, context TEXT NOT NULL, mode TEXT NOT NULL, record TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS composed_rules
          (id INTEGER PRIMARY KEY, context TEXT NOT NULL, mode TEXT NOT NULL, rule TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS composed_example_context ON composed_examples(context,mode);
          CREATE INDEX IF NOT EXISTS composed_rule_context ON composed_rules(context,mode);''')

        # Migrate existing evidence into the index without replacing observations.
        for row in list(self.db.execute('SELECT * FROM composed_examples')):
            e=json.loads(row['record'])
            self.engine.boundary_states.observe(self.hierarchy.raw(e['before'],row['mode']),{'example_id':row['id']},e['source'],
                                               ['composed-evidence',json.loads(row['context'])],row['mode'],row['id'])

    def hierarchy_context(self,context):return ['composed-state',context]

    def learn(self,examples,context=None,mode='character'):
        if not isinstance(examples,list) or not 3<=len(examples)<=32:raise ValueError('3..32 before/after/source pairs required')
        before=[];after=[]
        for e in examples:
            if not isinstance(e,dict) or set(e)!={'before','after','source'} or not isinstance(e['source'],str) or not 1<=len(e['source'])<=256:
                raise ValueError('before/after/source required')
            before.append(self.hierarchy.raw(e['before'],mode));after.append(self.hierarchy.raw(e['after'],mode))
        if len({encoded(x) for x in before})<3:raise ValueError('three distinct input states required')
        fits=[]
        for x,y in zip(before,after):
            fits.append({(tuple(y[:i]),tuple(y[i+len(x):])) for i in range(len(y)+1) if y[i:i+len(x)]==x})
        alternatives=sorted(set.intersection(*fits))
        raw_examples=[{'text':e[k],'source':e['source']} for e in examples for k in ('before','after')]
        discovery=self.hierarchy.learn(raw_examples,self.hierarchy_context(context),mode,rounds=32)
        ids=[];rules=[]
        def literal_state(raw):
            if not raw:return []
            text=bytes(raw).decode('utf-8') if mode=='byte' else ''.join(chr(x) for x in raw)
            return self.hierarchy.encode(text,self.hierarchy_context(context),mode)['units']
        with self.db:
            for e in examples:
                record={**e,'before_state':self.hierarchy.encode(e['before'],self.hierarchy_context(context),mode),
                        'after_state':self.hierarchy.encode(e['after'],self.hierarchy_context(context),mode)}
                ids.append(self.db.execute('INSERT INTO composed_examples(context,mode,record) VALUES (?,?,?)',
                                           (encoded(context),mode,encoded(record))).lastrowid)
            for ident,e in zip(ids,examples):
                self.engine.boundary_states.observe(self.hierarchy.raw(e['before'],mode),{'example_id':ident},e['source'],
                                                   ['composed-evidence',context],mode,ident)
            for prefix,suffix in alternatives:
                rule={'prefix_numbers':list(prefix),'suffix_numbers':list(suffix),
                      'prefix_state':literal_state(prefix),'suffix_state':literal_state(suffix),'examples':ids,
                      'operation':'concat(prefix,input,suffix)'}
                ident=self.db.execute('INSERT INTO composed_rules(context,mode,rule) VALUES (?,?,?)',(encoded(context),mode,encoded(rule))).lastrowid
                rules.append({'id':ident,**rule})
        return {'status':'learned' if rules else 'unsupported','rules':rules,'examples':ids,'evidence_retained':True,
                'discovery':discovery,'scope':'Observed whole-state concatenation transformations; targets supplied, not fact or meaning discovery.'}

    def inventory(self,context=None,mode='character'):
        self.hierarchy.select(self.hierarchy_context(context),mode)
        examples=list(self.db.execute('SELECT * FROM composed_examples WHERE context=? AND mode=?',(encoded(context),mode)))
        result=[]
        for row in self.db.execute('SELECT * FROM composed_rules WHERE context=? AND mode=? ORDER BY id',(encoded(context),mode)):
            rule=json.loads(row['rule']);support=[];conflict=[]
            for example in examples:
                e=json.loads(example['record'])
                predicted=rule['prefix_numbers']+self.hierarchy.raw(e['before'],mode)+rule['suffix_numbers']
                (support if predicted==self.hierarchy.raw(e['after'],mode) else conflict).append(example['id'])
            result.append({'id':row['id'],**rule,'supporting':support,'conflicting':conflict})
        return result

    def predict(self,text,context=None,mode='character',strategy='indexed'):
        raw=self.hierarchy.raw(text,mode);packet=self.hierarchy.encode(text,self.hierarchy_context(context),mode)
        outputs={};limited=False
        def add(output,evidence,state):
            c=outputs.setdefault(output,{'text':output,'state':state,'evidence':[]});c['evidence'].append(evidence)
        retrieval=self.engine.boundary_states.search(raw,['composed-evidence',context],mode,strategy)
        limited|=retrieval['search_limited']
        for match in retrieval['matches']:
            row=self.db.execute('SELECT * FROM composed_examples WHERE id=?',(match['payload']['example_id'],)).fetchone()
            e=json.loads(row['record'])
            add(e['after'],{'example':row['id'],'kind':'observed'},e['after_state']['units'])
        if packet['status']=='encoded':
            for rule in self.inventory(context,mode):
                # Copy the complete learned-state sequence; never add symbol IDs.
                state=rule['prefix_state']+packet['units']+rule['suffix_state']
                try:output=self.hierarchy.decode(state,mode)
                except ValueError:limited=True;continue
                add(output,{'rule':rule['id'],'kind':'induced','supporting':rule['supporting'],'conflicting':rule['conflicting']},state)
        return {'status':'bounded' if limited else 'predicted' if len(outputs)==1 else 'ambiguous' if outputs else 'unknown',
                'candidates':list(outputs.values()),'input_state':packet,'retrieval':retrieval,'search_limited':limited,'verified':False}

    def compose(self,text,contexts,mode='character',max_candidates=32):
        self.hierarchy.raw(text,mode)
        if not isinstance(contexts,list) or not 1<=len(contexts)<=8 or type(max_candidates) is not int or not 1<=max_candidates<=128:
            raise ValueError('1..8 transformation contexts and 1..128 candidates required')
        frontier=[{'text':text,'trace':[]}];limited=False;stages=[]
        for step,context in enumerate(contexts):
            outputs={}
            for previous in frontier:
                prediction=self.predict(previous['text'],context,mode);limited|=prediction['search_limited']
                for candidate in prediction['candidates']:
                    output=candidate['text']
                    if output not in outputs:
                        if len(outputs)>=max_candidates:limited=True;continue
                        outputs[output]={'text':output,'state':candidate['state'],'trace':[]}
                    outputs[output]['trace'].append({'step':step,'from':previous['text'],'context':context,'evidence':candidate['evidence']})
            frontier=list(outputs.values());stages.append({'context':context,'candidate_count':len(frontier),'states':[{'text':c['text'],'incoming':c['trace']} for c in frontier]})
            if not frontier:break
        return {'status':'bounded' if limited else 'predicted' if len(frontier)==1 else 'ambiguous' if frontier else 'unknown',
                'candidates':frontier,'stages':stages,'search_limited':limited,'verified':False,'executed':False,
                'scope':'Bounded composition of supervised symbolic rewrites; no assertion that generated sentences describe reality.'}
