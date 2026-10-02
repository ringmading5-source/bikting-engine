"""Evidence-aligned role learning over the existing byte/character bridge.

Role labels come from supplied records; no English grammar or causal knowledge
is installed. Distinct sentence forms need their own alignment evidence.
"""
import json
from pattern_memory import encoded

ROLES = {'actor', 'action', 'object'}

class RoleLearning:
    def __init__(self, engine):
        self.engine = engine
        self.bridge = engine.text_memory

    def context(self, context):
        # Keep role evidence separate from arbitrary text/record models.
        return {'role_learning': context}

    def validate(self, examples):
        if not isinstance(examples, list) or not 1 <= len(examples) <= 32:
            raise ValueError('1..32 aligned examples required')
        for example in examples:
            if not isinstance(example, dict) or set(example) != {'text', 'record'}:
                raise ValueError('text/record pairs required')
            self.bridge.validate_text(example['text'])
            record = example['record']
            if not isinstance(record, dict) or set(record) != ROLES or any(
                    not isinstance(v, str) or not v or len(v.split()) != 1 for v in record.values()):
                raise ValueError('actor, action and object must be nonempty single-token strings')

    def learn(self, examples, context=None):
        self.validate(examples)
        return self.bridge.learn(examples, self.context(context))

    def parse(self, text, context=None, level='byte'):
        result = self.bridge.parse(text, self.context(context), level)
        return {**result, 'model_calls': 0,
                'scope': 'Roles aligned from supplied examples; template prediction, not causal understanding.'}

    def evaluate(self, examples, context=None, level='byte'):
        self.validate(examples)
        observed = {json.loads(row['example'])['text'] for row in
                    self.engine.db.execute('SELECT example FROM bridge_examples WHERE context=?',
                                           (encoded(self.context(context)),))}
        if any(example['text'] in observed for example in examples):
            raise ValueError('evaluation sentences must be absent from training memory')
        cases = []
        for example in examples:
            result = self.parse(example['text'], context, level)
            correct = result['status'] == 'predicted' and result['candidates'][0]['record'] == example['record']
            cases.append({'text': example['text'], 'expected': example['record'],
                          'result': result, 'correct': correct})
        return {'correct': sum(case['correct'] for case in cases), 'total': len(cases),
                'cases': cases, 'model_calls': 0, 'evaluation_writes': 0}
