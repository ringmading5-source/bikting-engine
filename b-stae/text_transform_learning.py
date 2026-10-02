"""Supervised sequence-template induction with example-free inference.

Learns literals, variable spans and their output positions from paired examples.
The hypothesis language is programmed; the fitted template is learned. This is
structural transfer, not semantic understanding or raw-text language modelling.
"""
import copy
import hashlib
import json
from text_gap_learning import tokens
from text_relationship_learning import infer_pattern, bind, render
from sentence_learning import detokenize
from pattern_memory import encoded


def checked_text(value):
    if not isinstance(value,str) or not value.strip() or len(value)>2000 or len(tokens(value))>64:
        raise ValueError('nonempty text up to 2000 characters and 64 tokens required')
    return tokens(value)


class TextTransformModel:
    """A fitted template: predict reads only parameters and the current input."""
    def __init__(self,parameters):
        self.parameters=copy.deepcopy(parameters)

    @classmethod
    def fit(cls,examples):
        if not isinstance(examples,list) or not 3<=len(examples)<=32:
            raise ValueError('3..32 paired examples required')
        inputs=[];outputs=[]
        for example in examples:
            if not isinstance(example,dict) or set(example)!={'input','output'}:
                raise ValueError('input/output pairs required')
            inputs.append(checked_text(example['input']));outputs.append(checked_text(example['output']))
        if len({encoded(x) for x in inputs})<3:raise ValueError('three distinct inputs required')
        source,source_values=infer_pattern(inputs)
        target,target_values=infer_pattern(outputs)
        linked=[]
        for part in target:
            if 'literal' in part:linked.append(part);continue
            matches=[slot for slot,values in source_values.items() if values==target_values[part['slot']]]
            if len(matches)!=1:raise ValueError('output variation cannot be linked uniquely to input spans')
            linked.append({'slot':matches[0]})
        model=cls({'input_pattern':source,'output_pattern':linked,'training_pairs':len(examples)})
        for example,expected in zip(examples,outputs):
            result=model.predict(example['input'])
            if result['status']!='predicted' or tokens(result['outputs'][0])!=expected:
                raise ValueError('template does not reproduce training pairs uniquely')
        return model

    def predict(self,text):
        units=checked_text(text)
        bindings,limited=bind(self.parameters['input_pattern'],units)
        outputs={}
        for binding in bindings:
            result=render(self.parameters['output_pattern'],binding)
            if result is not None:outputs[encoded(result)]=detokenize(result)
        return {'status':'bounded' if limited else 'predicted' if len(outputs)==1 else 'ambiguous' if outputs else 'unknown',
                'outputs':list(outputs.values()),'verified':False,'training_example_lookups':0,
                'scope':'Learned sequence template applied to current input; no factual inference.'}

    def export(self):return copy.deepcopy(self.parameters)


class TextTransformLearning:
    def __init__(self,engine):
        self.db=engine.db
        self.db.executescript('''CREATE TABLE IF NOT EXISTS text_transform_models (
            id TEXT PRIMARY KEY, context TEXT NOT NULL, parameters TEXT NOT NULL,
            training TEXT NOT NULL, validation TEXT NOT NULL);''')

    def learn(self,examples,validation,context=None):
        model=TextTransformModel.fit(examples)
        if not isinstance(validation,list) or not 1<=len(validation)<=100:
            raise ValueError('1..100 held-out validation pairs required')
        training_inputs={encoded(checked_text(e['input'])) for e in examples};seen=set();cases=[]
        for case in validation:
            if not isinstance(case,dict) or set(case)!={'input','output'}:raise ValueError('input/output pairs required')
            key=encoded(checked_text(case['input']));expected=checked_text(case['output'])
            if key in training_inputs or key in seen:raise ValueError('validation input repeats training or validation')
            seen.add(key);result=model.predict(case['input'])
            correct=result['status']=='predicted' and tokens(result['outputs'][0])==expected
            cases.append({'input':case['input'],'expected':case['output'],**result,'correct':correct})
        report={'total':len(cases),'correct':sum(c['correct'] for c in cases),'cases':cases}
        if report['correct']!=report['total']:
            return {'status':'validation_failed','validation':report,'saved':False}
        parameters=model.export();ident=hashlib.sha256(encoded([context,parameters]).encode()).hexdigest()
        with self.db:self.db.execute('INSERT OR REPLACE INTO text_transform_models VALUES (?,?,?,?,?)',
            (ident,encoded(context),encoded(parameters),encoded(examples),encoded(report)))
        return {'status':'learned','model_id':ident,'parameters':parameters,'validation':report,
                'scope':'Supervised structural transfer; validation is a small test, not proof of universal generalization.'}

    def predict(self,text,context=None):
        checked_text(text);outputs={};models=[];limited=False
        # Deliberately exclude training and validation records from inference.
        for row in self.db.execute('SELECT id,parameters FROM text_transform_models WHERE context=? ORDER BY id',(encoded(context),)):
            result=TextTransformModel(json.loads(row['parameters'])).predict(text)
            models.append(row['id']);limited|=result['status']=='bounded'
            for output in result['outputs']:outputs.setdefault(output,[]).append(row['id'])
        return {'status':'bounded' if limited else 'predicted' if len(outputs)==1 else 'ambiguous' if outputs else 'unknown',
                'candidates':[{'text':text,'model_ids':ids} for text,ids in outputs.items()],
                'models_considered':models,'verified':False,'training_example_lookups':0,
                'scope':'Generation from fitted templates and supplied input; facts must be supplied or learned separately.'}
