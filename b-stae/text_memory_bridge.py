"""Supervised text/record alignment. No installed quantity vocabulary or plural rule."""
import itertools
import json
import re
from pattern_memory import encoded


def pieces(text):
    return re.findall(r'\S+',text)


def numbers(text,level):
    if level not in ('byte','character'):raise ValueError('byte or character level required')
    return list(text.encode('utf-8')) if level=='byte' else [ord(c) for c in text]


def readable(units,level):
    return bytes(units).decode('utf-8') if level=='byte' else ''.join(chr(n) for n in units)


def affixes(inputs, outputs):
    alternatives=[]
    for x,y in zip(inputs,outputs):
        alternatives.append({(tuple(y[:i]),tuple(y[i+len(x):])) for i in range(len(y)+1) if y[i:i+len(x)]==x})
    return sorted(set.intersection(*alternatives))


class TextMemoryBridge:
    def __init__(self,engine):
        self.engine=engine;self.db=engine.db
        self.db.executescript('''CREATE TABLE IF NOT EXISTS bridge_examples
          (id INTEGER PRIMARY KEY, context TEXT NOT NULL, example TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS bridge_models
          (id INTEGER PRIMARY KEY, context TEXT NOT NULL, model TEXT NOT NULL);''')

    def learn(self,examples,context=None):
        if not isinstance(examples,list) or not 3<=len(examples)<=32:raise ValueError('3..32 text/record pairs required')
        for e in examples:
            if not isinstance(e,dict) or set(e)!={'text','record'}:raise ValueError('text/record pair required')
            self.validate_text(e['text']);self.engine.memory_logic.validate(e['record'])
        fields=sorted(examples[0]['record'])
        if any(sorted(e['record'])!=fields for e in examples):raise ValueError('consistent record fields required')
        if len({encoded(e['record']) for e in examples})<3:raise ValueError('three distinct records required')
        models=[];limited=False
        for level in ('byte','character'):
            texts=[[numbers(t,level) for t in pieces(e['text'])] for e in examples];options=[]
            if len({len(t) for t in texts})==1:
                for position in range(len(texts[0])):
                    ys=[t[position] for t in texts];rules=[]
                    if len({encoded(y) for y in ys})==1:rules.append({'kind':'literal','token':ys[0]})
                    for field in fields:
                        xs=[e['record'][field] for e in examples]
                        if all(type(x) is str and x for x in xs) and len(set(xs))>=3:
                            for prefix,suffix in affixes([numbers(x,level) for x in xs],ys):
                                rules.append({'kind':'affix','field':field,'prefix':list(prefix),'suffix':list(suffix)})
                        if all(type(x) in (int,bool) for x in xs):
                            mapping={encoded(x):y for x,y in zip(xs,ys)}
                            if all(mapping[encoded(x)]==y for x,y in zip(xs,ys)):
                                rules.append({'kind':'lookup','field':field,'mapping':mapping})
                    options.append(rules)
            if options and all(options):
                for index,template in enumerate(itertools.product(*options)):
                    if index>=64:limited=True;break
                    if {r.get('field') for r in template if 'field' in r}==set(fields):
                        models.append({'level':level,'template':list(template),'fields':fields})
        with self.db:
            ids=[]
            for e in examples:
                packet=self.engine.numeric_text.encode(e['text'])
                linked={**e,'numeric_sentence_id':packet['sentence_id'],
                        'numeric_string_fields':{field:self.engine.numeric_text.encode(value)['sentence_id']
                                                 for field,value in e['record'].items() if type(value) is str and value}}
                ids.append(self.db.execute('INSERT INTO bridge_examples(context,example) VALUES (?,?)',
                                           (encoded(context),encoded(linked))).lastrowid)
            for model in models:
                model.update(examples=ids,search_limited=limited)
                self.db.execute('INSERT INTO bridge_models(context,model) VALUES (?,?)',(encoded(context),encoded(model)))
        return {'status':'bounded' if limited else 'learned' if models else 'unsupported','templates':models,'examples':ids,'evidence_retained':True,'search_limited':limited}

    def validate_text(self,text):
        if not isinstance(text,str) or not text.strip() or len(text)>512 or len(pieces(text))>16:
            raise ValueError('nonempty text up to 512 characters and 16 whitespace tokens required')
        try:text.encode('utf-8')
        except UnicodeEncodeError:raise ValueError('valid Unicode required') from None

    def template(self,model,level):
        if 'level' in model:return model['template'] if model['level']==level else None
        # Older string templates are compiled in memory without rewriting evidence.
        result=[]
        for part in model['template']:
            rule=dict(part)
            for key in ('token','prefix','suffix'):
                if key in rule:rule[key]=numbers(rule[key],level)
            if 'mapping' in rule:rule['mapping']={k:numbers(v,level) for k,v in rule['mapping'].items()}
            result.append(rule)
        return result

    def parse_index(self,context,level):
        # Reuse compiled evidence only while the database is unchanged. Grouping
        # identical templates saves work without dropping their provenance.
        version=(self.db.total_changes,self.db.execute('PRAGMA data_version').fetchone()[0],self.db.in_transaction)
        if getattr(self,'_parse_version',None)!=version:
            self._parse_version=version;self._parse_indexes={}
        key=(encoded(context),level)
        if not self.db.in_transaction and key in self._parse_indexes:return self._parse_indexes[key]
        observations={};models={}
        for row in self.db.execute('SELECT * FROM bridge_examples WHERE context=?',(encoded(context),)):
            e=json.loads(row['example'])
            units=tuple(tuple(numbers(t,level)) for t in pieces(e['text']))
            observations.setdefault(units,[]).append((e['record'],{'example':row['id'],'kind':'observed'}))
        for row in self.db.execute('SELECT * FROM bridge_models WHERE context=?',(encoded(context),)):
            model=json.loads(row['model']);template=self.template(model,level)
            if template is None:continue
            group=models.setdefault(encoded(template),{'template':template,'limited':False,'evidence':[]})
            group['limited']|=model.get('search_limited',False)
            group['evidence'].append({'model':row['id'],'examples':model['examples'],'kind':'induced'})
        if len(self._parse_indexes)>=8:self._parse_indexes.clear()
        result=(observations,list(models.values()))
        if not self.db.in_transaction:self._parse_indexes[key]=result
        return result

    def parse(self,text,context=None,level='byte'):
        self.validate_text(text);tokens=[numbers(t,level) for t in pieces(text)];outputs={};limited=False
        def add(record,evidence):
            c=outputs.setdefault(encoded(record),{'record':dict(record),'evidence':[]})
            copied=dict(evidence)
            if 'examples' in copied:copied['examples']=list(copied['examples'])
            c['evidence'].append(copied)
        observations,models=self.parse_index(context,level)
        for record,evidence in observations.get(tuple(tuple(t) for t in tokens),[]):add(record,evidence)
        for model in models:
            template=model['template']
            if len(template)!=len(tokens):continue
            limited|=model['limited']
            states=[{}]
            for rule,token in zip(template,tokens):
                if rule['kind']=='literal':
                    if token!=rule['token']:states=[];break
                    continue
                if rule['kind']=='lookup':values=[json.loads(k) for k,v in rule['mapping'].items() if v==token]
                else:
                    prefix,suffix=rule['prefix'],rule['suffix']
                    matches=token[:len(prefix)]==prefix and (not suffix or token[-len(suffix):]==suffix) and len(token)>len(prefix)+len(suffix)
                    values=[]
                    if matches:
                        try:values=[readable(token[len(prefix):len(token)-len(suffix) if suffix else len(token)],level)]
                        except (UnicodeDecodeError,ValueError):pass
                next_states=[]
                for state in states:
                    for value in values:
                        field=rule['field']
                        if field in state and encoded(state[field])!=encoded(value):continue
                        if len(next_states)>=128:limited=True;break
                        next_states.append({**state,field:value})
                states=next_states
            for record in states:
                for evidence in model['evidence']:add(record,evidence)
        return {**self.result(outputs,limited),'operating_level':level,'input_numbers':tokens}

    def express(self,record,context=None,level='byte'):
        self.engine.memory_logic.validate(record);numbers('',level);outputs={};limited=False
        def add(text,evidence):
            c=outputs.setdefault(text,{'text':text,'numbers':numbers(text,level),'evidence':[]});c['evidence'].append(evidence)
        for row in self.db.execute('SELECT * FROM bridge_examples WHERE context=?',(encoded(context),)):
            e=json.loads(row['example'])
            if encoded(e['record'])==encoded(record):add(e['text'],{'example':row['id'],'kind':'observed'})
        for row in self.db.execute('SELECT * FROM bridge_models WHERE context=?',(encoded(context),)):
            model=json.loads(row['model']);template=self.template(model,level)
            if template is None or sorted(record)!=model['fields']:continue
            limited|=model.get('search_limited',False)
            tokens=[]
            for rule in template:
                if rule['kind']=='literal':tokens.append(rule['token'])
                elif rule['kind']=='lookup':
                    token=rule['mapping'].get(encoded(record[rule['field']]))
                    if token is None:break
                    tokens.append(token)
                else:
                    value=record[rule['field']]
                    if type(value) is not str or not value or len(pieces(value))!=1:break
                    tokens.append(rule['prefix']+numbers(value,level)+rule['suffix'])
            else:
                output=[]
                for token in tokens:
                    if output:output.append(32)
                    output.extend(token)
                add(readable(output,level),{'model':row['id'],'examples':model['examples'],'kind':'induced'})
        return {**self.result(outputs,limited),'operating_level':level}

    def result(self,outputs,limited):
        return {'status':'bounded' if limited else 'predicted' if len(outputs)==1 else 'ambiguous' if outputs else 'unknown',
                'candidates':list(outputs.values()),'search_limited':limited,'verified':False}
