"""Supervised induction of bounded numeric slot patterns from labeled text.

Sentence frames and slot order come from examples, not handwritten intent rules.
Number decoding is an installed English adapter; semantics are supplied labels.
"""
import hashlib
import itertools
import json
import re
import unicodedata
from representation import canonical
from transition_learning import state, gate
from text_transition import number, NUMBER


def tokens(text):
    if not isinstance(text, str) or not 1 <= len(text) <= 500 or '\n' in text:
        raise ValueError('one bounded text input required')
    text = unicodedata.normalize('NFKC', text).casefold()
    text = re.sub(r'(?<=[a-z])-(?=[a-z])', ' ', text)
    result = re.findall(r'\d+|[a-z]+|[^\s]', text)
    if len(result) > 80: raise ValueError('text token budget exceeded')
    return result


def label(example):
    if not isinstance(example, dict) or set(example) != {'text','state','action','context','relationships','source'}:
        raise ValueError('complete text/state/action/context/relationships/source example required')
    state(example['state']); tokens(example['text'])
    if len(example['state']) > 4 or any(v < 0 for v in example['state'].values()):
        raise ValueError('1..4 nonnegative numeric slots supported')
    if not isinstance(example['source'], str) or not 1 <= len(example['source']) <= 256:
        raise ValueError('evidence source required')
    return gate(example['action'], example['context'], example['relationships'])


def induce(example):
    words = tokens(example['text']); fields = sorted(example['state']); options = []
    for field in fields:
        candidates = []
        for start in range(len(words)):
            for size in (1,2):
                end = start + size
                if end > len(words): continue
                try: value = number(' '.join(words[start:end]))
                except ValueError: continue
                if value == example['state'][field]: candidates.append((start,end,field))
        if not 1 <= len(candidates) <= 8: raise ValueError('missing or ambiguous numeric slot evidence')
        options.append(candidates)
    if __import__('math').prod(len(c) for c in options) > 128:
        raise ValueError('slot alignment budget exceeded')
    patterns = {}
    for assignment in itertools.product(*options):
        ordered = sorted(assignment)
        if any(a[1] > b[0] for a,b in zip(ordered,ordered[1:])): continue
        pattern = []; offset = 0
        for start,end,field in ordered:
            pattern.extend(words[offset:start]); pattern.append({'slot':field}); offset=end
        pattern.extend(words[offset:])
        # Do not silently freeze an extra quantity into a sentence literal.
        extra = False
        for item in pattern:
            if not isinstance(item,str): continue
            try: number(item); extra = True
            except ValueError: pass
        if not extra: patterns[canonical(pattern)] = pattern
    if len(patterns) != 1: raise ValueError('text does not identify a unique slot binding')
    return next(iter(patterns.values()))


def match(pattern, text):
    fields = [item['slot'] for item in pattern if isinstance(item,dict)]
    # Regex group names use safe synthetic IDs, independent of state field names.
    parts = []; index = 0
    for item in pattern:
        if isinstance(item,str): parts.append(re.escape(item))
        else:
            parts.append(f'(?P<s{index}>{NUMBER})'); index += 1
    found = re.fullmatch(' '.join(parts), ' '.join(tokens(text)))
    if found is None: return None
    try: return {field:number(found.group(f's{i}')) for i,field in enumerate(fields)}
    except ValueError: return None


class TextPatternLearning:
    def __init__(self, engine):
        self.db = engine.db
        from coupled_transition_learning import CoupledTransitionLearning
        self.transitions = CoupledTransitionLearning(engine)
        self.db.execute('CREATE TABLE IF NOT EXISTS text_pattern_models (id TEXT PRIMARY KEY, payload TEXT NOT NULL, active INTEGER NOT NULL)')

    def learn(self, examples, validation):
        if not isinstance(examples,list) or not 3 <= len(examples) <= 32 or not isinstance(validation,list) or not 1 <= len(validation) <= 16:
            raise ValueError('3..32 training and 1..16 validation examples required')
        expected_gate = label(examples[0]); schema = set(examples[0]['state'])
        texts = set(); training_states = set(); groups = {}
        for role, records in [('training',examples),('validation',validation)]:
            for item in records:
                if canonical(label(item)) != canonical(expected_gate) or set(item['state']) != schema:
                    raise ValueError('one gate and schema per text model required')
                key = canonical(tokens(item['text']))
                if key in texts: raise ValueError('duplicate text or validation leakage')
                texts.add(key)
                value = canonical(item['state'])
                if role == 'training':
                    training_states.add(value)
                    pattern = induce(item)
                    group = groups.setdefault(canonical(pattern), {'pattern':pattern,'examples':[]})
                    group['examples'].append(item)
                elif value in training_states: raise ValueError('validation state must be withheld')
        for group in groups.values():
            if len(group['examples']) < 3 or any(len({item['state'][field] for item in group['examples']}) < 3 for field in schema):
                return {'status':'insufficient_variation','reason':'Each sentence frame requires three distinct values per slot.','model_calls':0}
        model = {'version':1,'gate':expected_gate,'schema':sorted(schema),
                 'patterns':[groups[k]['pattern'] for k in sorted(groups)],
                 'examples':examples,'validation':validation,
                 'scope':'learned literal sentence frames with numeric slots; supplied semantic labels and installed number decoder'}
        for item in examples + validation:
            parsed = self.parse_model(model,item['text'])
            if parsed['status'] != 'parsed' or parsed['state'] != item['state']:
                return {'status':'validation_failed','model_calls':0}
        ident = hashlib.sha256(canonical(model)).hexdigest()
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO text_pattern_models VALUES (?,?,1)', (ident,canonical(model).decode()))
        return {'status':'text_hypothesis_saved','text_model_id':ident,'patterns':model['patterns'],
                'training_count':len(examples),'validation_count':len(validation),'model_calls':0,'scope':model['scope']}

    def get(self, ident):
        row = self.db.execute('SELECT payload,active FROM text_pattern_models WHERE id=?',(ident,)).fetchone()
        if row is None: raise ValueError('unknown text model')
        model = json.loads(row['payload'])
        if hashlib.sha256(canonical(model)).hexdigest() != ident: raise ValueError('corrupt text evidence')
        return model,bool(row['active'])

    @staticmethod
    def parse_model(model, text):
        results = {}
        for pattern in model['patterns']:
            value = match(pattern,text)
            if value is not None: results[canonical(value)] = value
        if not results: return {'status':'unsupported','reason':'No learned sentence frame matches.','model_calls':0}
        if len(results) > 1: return {'status':'ambiguous','reason':'Learned patterns disagree on slot bindings.','model_calls':0}
        return dict(model['gate'],status='parsed',state=next(iter(results.values())),model_calls=0)

    def parse(self, ident, text):
        model,active = self.get(ident)
        if not active: return {'status':'disabled','model_calls':0}
        return self.parse_model(model,text)

    def feedback(self, ident, example):
        model,active = self.get(ident)
        observed_gate = label(example)
        if canonical(observed_gate) != canonical(model['gate']) or sorted(example['state']) != model['schema']:
            return {'status':'context_mismatch','model_calls':0}
        result = self.parse_model(model,example['text'])
        if result['status'] == 'unsupported': return result
        supported = result.get('state') == example['state']
        if not supported:
            with self.db: self.db.execute('UPDATE text_pattern_models SET active=0 WHERE id=?',(ident,))
        return {'status':'supported_on_example' if supported else 'text_hypothesis_disabled','active':active and supported,'model_calls':0}

    def answer(self, text_model_id, transition_model_id, text):
        request = self.parse(text_model_id,text)
        if request['status'] != 'parsed': return request
        # The numeric learner checks the learned text gate against its own evidence.
        prediction = self.transitions.predict(transition_model_id,request['state'],request['action'],request['context'],request['relationships'])
        result = {'status':prediction['status'],'request':request,'prediction':prediction,'model_calls':0,
                  'scope':'supervised sentence-frame induction followed by checked numeric hypothesis prediction'}
        if prediction['status'] == 'predicted': result['answer'] = 'Predicted state: '+json.dumps(prediction['state'],sort_keys=True)
        return result
