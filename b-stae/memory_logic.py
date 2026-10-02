"""Bounded induction over structured records. Field names carry no built-in semantics."""
import itertools
import json
from pattern_memory import encoded
from text_relationship_learning import infer_pattern, bind, render


class MemoryLogic:
    def __init__(self, engine):
        self.engine = engine
        self.db = engine.db
        self.db.executescript('''CREATE TABLE IF NOT EXISTS logic_examples
          (id INTEGER PRIMARY KEY, context TEXT NOT NULL, record TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS logic_models
          (id INTEGER PRIMARY KEY, context TEXT NOT NULL, model TEXT NOT NULL);''')

    def validate(self, record):
        if not isinstance(record, dict) or not record or len(record)>8:
            raise ValueError('1..8 fields required')
        for key,value in record.items():
            if not isinstance(key,str) or not key or len(key)>64:
                raise ValueError('bounded field names required')
            if type(value) not in (str,int,bool) or (isinstance(value,str) and len(value)>128) or (type(value) is int and abs(value)>10**12):
                raise ValueError('bounded string, integer or boolean values required')

    def learn(self, examples, context=None):
        if not isinstance(examples,list) or not 3<=len(examples)<=32:
            raise ValueError('3..32 linked records required')
        for e in examples:
            if not isinstance(e,dict) or set(e)!={'input','output'}:raise ValueError('input/output records required')
            self.validate(e['input']);self.validate(e['output'])
        if any(set(e['input'])!=set(examples[0]['input']) or set(e['output'])!=set(examples[0]['output']) for e in examples):
            raise ValueError('consistent fields required')
        if len({encoded(e['input']) for e in examples})<3:raise ValueError('three distinct inputs required')
        rules={}
        for target in examples[0]['output']:
            ys=[e['output'][target] for e in examples];options=[]
            for source in examples[0]['input']:
                xs=[e['input'][source] for e in examples]
                if all(type(x) is str for x in xs) and all(type(y) is str for y in ys) and len(set(xs))>=3:
                    for level in ('character','byte'):
                        units=lambda s:list(s) if level=='character' else list(s.encode('utf-8'))
                        # Fit a whole-input binding with observed prefix/suffix literals.
                        affixes=[]
                        for x,y in zip(xs,ys):
                            positions=[i for i in range(len(y)+1) if y.startswith(x,i)]
                            affixes.append({(y[:i],y[i+len(x):]) for i in positions})
                        for prefix,suffix in sorted(set.intersection(*affixes)):
                            options.append({'kind':'sequence','source':source,'level':level,
                                            'input':[{'slot':0,'min_tokens':min(len(units(x)) for x in xs)}],
                                            'output':[{'literal':v} for v in units(prefix)]+[{'slot':0}]+[{'literal':v} for v in units(suffix)]})
                        pattern,slots=infer_pattern([units(x) for x in xs])
                        output,variables=infer_pattern([units(y) for y in ys]);linked=[]
                        for part in output:
                            if 'literal' in part:linked.append(part);continue
                            matches=[slot for slot,values in slots.items() if values==variables[part['slot']]]
                            if len(matches)!=1:break
                            linked.append({'slot':matches[0]})
                        else:
                            if all(any(render(linked,b)==units(y) for b in bind(pattern,units(x))[0]) for x,y in zip(xs,ys)):
                                options.append({'kind':'sequence','source':source,'level':level,'input':pattern,'output':linked})
                if all(type(x) is int for x in xs) and all(type(y) is bool for y in ys) and len(set(xs))>=3 and len(set(ys))==2:
                    for threshold in sorted(set(xs)):
                        for operator in ('gt','le'):
                            if all((x>threshold if operator=='gt' else x<=threshold)==y for x,y in zip(xs,ys)):
                                options.append({'kind':'comparison','source':source,'operator':operator,'threshold':threshold})
                if all(type(x) is int for x in xs) and all(type(y) is int for y in ys) and len(set(xs))>=3:
                    from relationship_discovery import numeric_fragments
                    for part in numeric_fragments(xs,ys):
                        options.append({'kind':'numeric','source':source,'program':[part]})
                if all(type(x)==type(y) and x==y for x,y in zip(xs,ys)) and len({encoded(x) for x in xs})>=3:
                    options.append({'kind':'copy','source':source})
            if len({encoded(y) for y in ys})==1:
                options.append({'kind':'constant','value':ys[0]})
            rules[target]=options
        with self.db:
            ids=[self.db.execute('INSERT INTO logic_examples(context,record) VALUES (?,?)',(encoded(context),encoded(e))).lastrowid for e in examples]
            model={'rules':rules,'examples':ids}
            ident=self.db.execute('INSERT INTO logic_models(context,model) VALUES (?,?)',(encoded(context),encoded(model))).lastrowid
        return {'status':'learned' if all(rules.values()) else 'unsupported','model_id':ident,'model':model,'evidence_retained':True,
                'supplied':'Record boundaries, field labels and example outputs.','learned':'Sequence bindings, observed literals, copy links and integer comparisons.'}

    def predict(self, record, context=None):
        self.validate(record);outputs={};limited=False
        def add(value,evidence):
            candidate=outputs.setdefault(encoded(value),{'record':value,'evidence':[]})
            candidate['evidence'].append(evidence)
        for row in self.db.execute('SELECT * FROM logic_examples WHERE context=?',(encoded(context),)):
            example=json.loads(row['record'])
            if encoded(record)==encoded(example['input']):add(example['output'],{'example':row['id'],'kind':'observed'})
        for row in self.db.execute('SELECT * FROM logic_models WHERE context=?',(encoded(context),)):
            model=json.loads(row['model']);fields={}
            for target,rules in model['rules'].items():
                values={}
                for rule in rules:
                    x=record.get(rule.get('source'));results=[]
                    if rule['kind']=='constant':results=[rule['value']]
                    elif rule['kind']=='numeric' and type(x) is int:
                        from relationship_discovery import apply
                        results=apply(rule['program'],[x])
                    elif rule['kind']=='copy' and rule['source'] in record:results=[x]
                    elif rule['kind']=='comparison' and type(x) is int:
                        results=[x>rule['threshold'] if rule['operator']=='gt' else x<=rule['threshold']]
                    elif rule['kind']=='sequence' and type(x) is str:
                        units=list(x) if rule['level']=='character' else list(x.encode('utf-8'))
                        bindings,bounded=bind(rule['input'],units);limited|=bounded
                        for binding in bindings:
                            result=render(rule['output'],binding)
                            try:results.append(''.join(result) if rule['level']=='character' else bytes(result).decode('utf-8'))
                            except (ValueError,UnicodeDecodeError):continue
                    for value in results:values[encoded(value)]=value
                fields[target]=list(values.values())
            if not fields or not all(fields.values()):continue
            for index,values in enumerate(itertools.product(*fields.values())):
                if index>=128:limited=True;break
                add(dict(zip(fields,values)),{'model':row['id'],'examples':model['examples'],'kind':'induced'})
        return {'status':'bounded' if limited else 'predicted' if len(outputs)==1 else 'ambiguous' if outputs else 'unknown',
                'candidates':list(outputs.values()),'search_limited':limited,'verified':False}
