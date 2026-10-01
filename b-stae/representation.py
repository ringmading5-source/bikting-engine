"""Shared, versioned multimodal states and atomically verified trajectories.

Adapters encode explicit data; they do not infer speech, meaning or image labels.
"""
import copy
import hashlib
import json
from recognition import recognize
from core import BinaryState, Record, UTF8

BITS = {'text': 1, 'voice': 2, 'visual': 4}


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False,
                      separators=(',', ':')).encode('utf-8')


def represent(value):
    if not isinstance(value, dict) or set(value) != {'version', 'sequence', 'relationships', 'output_code'}:
        raise ValueError('version, sequence, relationships and output_code required')
    if type(value['version']) is not int or value['version'] != 1:
        raise ValueError('unsupported representation version')
    code = value['output_code']
    if not isinstance(code, str) or len(code) != 3 or any(c not in '01' for c in code):
        raise ValueError('three-bit output_code required')
    sequence = value['sequence']
    if not isinstance(sequence, list) or not 1 <= len(sequence) <= 64:
        raise ValueError('sequence requires 1..64 items')
    ids = set()
    for item in sequence:
        if not isinstance(item, dict) or set(item) != {'id', 'modality', 'value', 'timing', 'position'}:
            raise ValueError('item requires id, modality, value, timing and position')
        ident = item['id']
        if not isinstance(ident, str) or not 1 <= len(ident) <= 128 or ident in ids:
            raise ValueError('unique bounded item IDs required')
        ids.add(ident)
        timing = item['timing']
        if not isinstance(timing, dict) or set(timing) != {'start_ms', 'duration_ms'} or any(type(v) is not int or not 0 <= v <= 3600000 for v in timing.values()):
            raise ValueError('bounded integer timing required')
        pos = item['position']
        if pos is not None and (not isinstance(pos, list) or len(pos) != 3 or any(type(v) is not int or abs(v) > 1000000 for v in pos)):
            raise ValueError('position must be null or three bounded integers')
        modality, data = item['modality'], item['value']
        if modality == 'text':
            if not isinstance(data, str): raise ValueError('text requires a string')
            # Explicit modality preserves color-like strings as text.
            BinaryState((Record(1, UTF8, data.encode('utf-8')),)).encode()
        elif modality == 'voice':
            if not isinstance(data, dict) or set(data) != {'audio'}: raise ValueError('voice requires PCM audio')
            recognize(data).state.encode()
        elif modality == 'visual':
            recognized = recognize(data)
            if recognized.representation not in ('rgb24', 'position3'): raise ValueError('visual requires a color or position')
            recognized.state.encode()
        else:
            raise ValueError('unsupported modality')
    relations = value['relationships']
    if not isinstance(relations, list) or len(relations) > 256: raise ValueError('bounded relationships required')
    for relation in relations:
        if not isinstance(relation, dict) or set(relation) != {'from', 'to', 'kind'} or relation['from'] not in ids or relation['to'] not in ids or relation['kind'] not in ('synchronized', 'precedes', 'describes'):
            raise ValueError('invalid relationship or missing endpoint')
        left, right = (next(i for i in sequence if i['id'] == relation[k]) for k in ('from', 'to'))
        if relation['kind'] == 'synchronized' and left['timing'] != right['timing']:
            raise ValueError('synchronized items require identical timing')
        if relation['kind'] == 'precedes' and left['timing']['start_ms'] + left['timing']['duration_ms'] > right['timing']['start_ms']:
            raise ValueError('precedes relationship violates timing')
    raw = canonical(value)
    if len(raw) > 500000: raise ValueError('representation byte budget exceeded')
    packet = BinaryState((Record(1, UTF8, raw),)).encode()
    return {'state_id': hashlib.sha256(packet).hexdigest(), 'state_hex': packet.hex(), 'representation': copy.deepcopy(value)}


class RepresentationMemory:
    def __init__(self, engine):
        self.engine, self.db = engine, engine.db
        self.db.execute('CREATE TABLE IF NOT EXISTS representation_trajectories (id TEXT PRIMARY KEY, event TEXT NOT NULL)')

    def transition(self, state, steps, max_steps=16):
        if type(max_steps) is not int or not 1 <= max_steps <= 64 or not isinstance(steps, list) or not 1 <= len(steps) <= max_steps:
            raise ValueError('transition step budget exceeded')
        before = represent(state)
        current = copy.deepcopy(state)
        trace = []
        for index, step in enumerate(steps):
            if not isinstance(step, dict) or set(step) != {'item', 'intent', 'expected'}:
                raise ValueError('step requires item, intent and expected result')
            item = next((i for i in current['sequence'] if i['id'] == step['item']), None)
            if item is None: raise ValueError('unknown item')
            # Preserve explicit text typing even for strings such as #abcdef.
            if item['modality'] == 'text':
                intent = self.engine.intents.parse(step['intent'])
                if intent['operation'] != 'append': raise ValueError('text adapter supports append')
                target, rule = self.engine.intents.boundary(BinaryState((Record(1, UTF8, item['value'].encode()),)), intent)
                observed = rule.apply(BinaryState((Record(1, UTF8, item['value'].encode()),)))
                if observed.encode() != target.encode(): raise ValueError('text target mismatch')
                decoded = observed.get(1).payload.decode('utf-8')
            else:
                result = self.engine.intents.execute(item['value'], step['intent'])
                if not result.get('verified'): raise ValueError('unverified transition')
                decoded = result['decoded']
                if item['modality'] == 'voice':
                    decoded = {'audio': {'samples': decoded, 'sample_rate': item['value']['audio']['sample_rate']}}
                elif isinstance(item['value'], dict): decoded = {'position': decoded}
                else: decoded = decoded['hex']
            if canonical(decoded) != canonical(step['expected']): raise ValueError('observed result differs from expected result')
            entry_id = represent(current)['state_id']
            item['value'] = decoded
            after = represent(current)
            trace.append({'step_id': index, 'item': step['item'], 'intent': step['intent'], 'before': entry_id, 'after': after['state_id'], 'verified': True})
        after = represent(current)
        code = int(current['output_code'], 2)
        outputs = [copy.deepcopy(i) for i in current['sequence'] if code & BITS[i['modality']]]
        event = {'version': 1, 'before': before['state_id'], 'after': after['state_id'], 'trace': trace, 'output_code': current['output_code'], 'outputs': outputs, 'state': current, 'verified': True}
        ident = hashlib.sha256(canonical(event)).hexdigest()
        event['trajectory_id'] = ident
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO representation_trajectories VALUES (?, ?)', (ident, canonical(event).decode()))
        return event

    def get(self, ident):
        row = self.db.execute('SELECT event FROM representation_trajectories WHERE id=?', (ident,)).fetchone()
        if row is None: raise ValueError('unknown trajectory')
        event = json.loads(row[0])
        saved = event.pop('trajectory_id')
        if saved != ident or hashlib.sha256(canonical(event)).hexdigest() != ident: raise ValueError('corrupt trajectory')
        represent(event['state'])
        event['trajectory_id'] = ident
        return event
