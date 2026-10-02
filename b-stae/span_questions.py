"""Learn question/answer mappings onto previously learned unlabeled span slots."""
import hashlib
import json
from text_relationship_learning import bind, infer_pattern, render
from text_transform_learning import checked_text
from unlabeled_patterns import text_units
from text_gap_learning import tokens
from sentence_learning import detokenize
from pattern_memory import encoded


class SpanQuestions:
    def __init__(self,engine):
        self.db=engine.db
        self.db.execute('''CREATE TABLE IF NOT EXISTS span_question_models (
            id TEXT PRIMARY KEY, context TEXT NOT NULL, parameters TEXT NOT NULL, training TEXT NOT NULL)''')

    def learn(self,span_model_id,examples,validation,context=None):
        row=self.db.execute('SELECT parameters,context,training FROM unlabeled_span_models WHERE id=?',(span_model_id,)).fetchone()
        if row is None or row['context']!=encoded(context):raise ValueError('span model must exist in this context')
        patterns=json.loads(row['parameters'])['patterns']
        if len(patterns)!=1:raise ValueError('one supported learned span pattern required')
        pattern=patterns[0]
        if not isinstance(examples,list) or not 3<=len(examples)<=32:raise ValueError('3..32 passage/question/answer examples required')
        if not isinstance(validation,list) or not 1<=len(validation)<=32:raise ValueError('1..32 held-out validation examples required')
        parsed=[];keys=set();training_passages={encoded(text_units(text)) for text in json.loads(row['training'])}
        for role,records in [('training',examples),('validation',validation)]:
            for example in records:
                if not isinstance(example,dict) or set(example)!={'passage','question','answer'}:raise ValueError('passage/question/answer required')
                units=text_units(example['passage']);checked_text(example['question']);checked_text(example['answer'])
                key=encoded([units,tokens(example['question'])])
                if key in keys or (role=='validation' and encoded(units) in training_passages):raise ValueError('repeated passage/question or validation leakage')
                if role=='training':training_passages.add(encoded(units))
                keys.add(key)
                matches,limited=bind(pattern,units)
                if limited or len(matches)!=1:raise ValueError('passage must bind learned span pattern uniquely')
                if role=='training':parsed.append(matches[0])
        slots=sorted(parsed[0]);columns={slot:[binding[slot] for binding in parsed] for slot in slots}
        if any(len({encoded(value) for value in column})<3 for column in columns.values()):
            raise ValueError('three distinct values per question-mapping slot required')
        outputs={}
        for field in ('question','answer'):
            fitted,variables=infer_pattern([tokens(example[field]) for example in examples]);linked=[]
            for part in fitted:
                if 'literal' in part:linked.append(part);continue
                matching=[slot for slot,column in columns.items() if column==variables[part['slot']]]
                if len(matching)!=1:raise ValueError('question/answer variation must link uniquely to learned spans')
                linked.append({'slot':matching[0]})
            outputs[field]=linked
        parameters={'span_model_id':span_model_id,'passage_pattern':pattern,**outputs}
        results=[]
        for example in examples+validation:
            answer=self.apply(parameters,example['passage'],example['question'])
            correct=(answer['status']=='answered' and tokens(answer['candidates'][0]['answer'])==tokens(example['answer']))
            if example in validation:results.append({'question':example['question'],'correct':correct})
            if not correct:return {'status':'validation_failed','saved':False,'validation':results}
        ident=hashlib.sha256(encoded([context,parameters]).encode()).hexdigest()
        with self.db:self.db.execute('INSERT OR REPLACE INTO span_question_models VALUES (?,?,?,?)',
                                     (ident,encoded(context),encoded(parameters),encoded(examples)))
        return {'status':'learned','model_id':ident,'span_model_id':span_model_id,'parameters':parameters,
                'validation':results,'scope':'Supervised QA links onto an unlabeled learned passage frame.'}

    def apply(self,parameters,passage,question):
        units=text_units(passage);checked_text(question)
        matches,limited=bind(parameters['passage_pattern'],units);outputs={}
        for binding in matches:
            if render(parameters['question'],binding)!=tokens(question):continue
            answer=render(parameters['answer'],binding)
            if answer is None:continue
            text=detokenize(answer);outputs.setdefault(text,{'answer':text,'evidence':[]})['evidence'].append(
                {'span_model_id':parameters['span_model_id'],'bindings':binding})
        return {'status':'bounded' if limited else 'answered' if len(outputs)==1 else 'ambiguous' if outputs else 'unknown',
                'candidates':list(outputs.values()),'search_limited':limited,'verified':False}

    def answer(self,question,context=None):
        checked_text(question);models=list(self.db.execute('SELECT id,parameters FROM span_question_models WHERE context=?',(encoded(context),)))
        passages=list(self.db.execute('SELECT id,source,text FROM knowledge_passages WHERE context=? ORDER BY id',(encoded(context),)))
        if len(passages)*len(models)>256:
            return {'status':'bounded','candidates':[],'trace':{},'search_limited':True,'reason':'More than 256 passage/model comparisons.'}
        outputs={};trace={};limited=False
        for passage in passages:
            try:text_units(passage['text'])
            except ValueError:continue  # This frame learner supports only bounded whole passages.
            for model in models:
                parameters=json.loads(model['parameters']);result=self.apply(parameters,passage['text'],question)
                limited|=result['search_limited']
                for candidate in result['candidates']:
                    key=encoded(tokens(passage['text']))
                    node=trace.setdefault(key,{'text':detokenize(tokens(passage['text'])),'depth':0,'parents':[],
                                              'sources':[],'span_model_ids':[]})
                    source={'source':passage['source'],'passage_id':passage['id']}
                    if source not in node['sources']:node['sources'].append(source)
                    if parameters['span_model_id'] not in node['span_model_ids']:node['span_model_ids'].append(parameters['span_model_id'])
                    item=outputs.setdefault(candidate['answer'],{'answer':candidate['answer'],'evidence':[]})
                    item['evidence'].append({'fact':key,'question_model_id':model['id'],'kind':'learned_span_question',
                                             'span_evidence':candidate['evidence'],'source':source})
        return {'status':'bounded' if limited else 'answered' if len(outputs)==1 else 'ambiguous' if outputs else 'unknown',
                'candidates':list(outputs.values()),'trace':trace,'search_limited':limited,'verified':False,
                'scope':'Questions mapped onto learned unlabeled span frames in earlier stored passages; supervised question mapping.'}
