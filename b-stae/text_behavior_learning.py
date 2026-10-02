"""Bridge ordered text observations into learned behavior and back into text.

No domain parser or named semantic roles are installed. A generic lexical codec
separates canonical integer runs from losslessly encoded text spans. Supplied
trajectory boundaries/order are evidence, not inferred from arbitrary prose.
"""
import json
import re
from pattern_memory import encoded

INTEGER = re.compile(r'(?<![\w.])-?(?:0|[1-9][0-9]*)(?!\w|\.[0-9])')


class TextBehaviorLearning:
    def __init__(self, engine):
        self.engine = engine
        self.db = engine.db
        self.db.execute('''CREATE TABLE IF NOT EXISTS text_behavior_batches
          (id INTEGER PRIMARY KEY, context TEXT NOT NULL, mode TEXT NOT NULL, record TEXT NOT NULL)''')

    def scope(self, context, mode):
        if mode not in ('character', 'byte'):
            raise ValueError('character or byte mode required')
        return ['text-behavior', mode, context]

    def encode(self, text):
        if not isinstance(text, str) or not 1 <= len(text) <= 128:
            raise ValueError('1..128 characters per text state required')
        self.engine.recursive_patterns.raw(text, 'character')
        matches = list(INTEGER.finditer(text))
        if len(matches) > 2:
            raise ValueError('at most two integer spans per observation in this experiment')
        state = {}
        offset = 0
        for i, match in enumerate(matches):
            state['span'+str(i)] = json.dumps(text[offset:match.start()], ensure_ascii=False)
            number = int(match.group())
            if str(number) != match.group():
                raise ValueError('canonical integer spelling required for numeric spans')
            state['number'+str(i)] = number
            offset = match.end()
        state['span'+str(len(matches))] = json.dumps(text[offset:], ensure_ascii=False)
        self.engine.behavior.state(state)
        if self.decode(state) != text:
            raise ValueError('text-state round trip failed')
        return state

    def decode(self, state):
        self.engine.behavior.state(state)
        count = sum(k.startswith('number') for k in state)
        expected = {'span'+str(i) for i in range(count+1)} | {'number'+str(i) for i in range(count)}
        if set(state) != expected or count > 2:
            raise ValueError('invalid positional text-state schema')
        parts = []
        for i in range(count+1):
            fragment = json.loads(state['span'+str(i)])
            if not isinstance(fragment, str):
                raise ValueError('text spans must decode to strings')
            parts.append(fragment)
            if i < count:
                if type(state['number'+str(i)]) is not int:
                    raise ValueError('integer span required')
                parts.append(str(state['number'+str(i)]))
        text = ''.join(parts)
        if not 1 <= len(text) <= 128:
            raise ValueError('decoded text outside length budget')
        text.encode('utf-8')
        return text

    def learn(self, episodes, source, context=None, mode='character'):
        scope = self.scope(context, mode)
        self.engine.behavior.source(source)
        if not isinstance(episodes, list) or not 3 <= len(episodes) <= 8:
            raise ValueError('3..8 observed text trajectories required')
        states = []
        observations = []
        for episode in episodes:
            if not isinstance(episode, list) or not 3 <= len(episode) <= 5:
                raise ValueError('3..5 ordered text states per trajectory required')
            trajectory = []
            for text in episode:
                raw = self.engine.recursive_patterns.raw(text, mode)
                if len(raw) > 256 or '<mask>' in text:
                    raise ValueError('at most 256 base units and no mask in observations')
                trajectory.append(self.encode(text))
                observations.append(dict(text=text, source=source))
            states.append(trajectory)
        if len(observations) > 32:
            raise ValueError('at most 32 text observations per batch')
        # Train a version of the raw hierarchy, then retain the codec alignment
        # linking each whole text observation to its automatically derived state.
        raw_model = self.engine.recursive_text.train(observations, scope, mode, include_history=False)
        behavior = self.engine.behavior.learn_episodes(states, source, scope)
        with self.db:
            ident = self.db.execute('INSERT INTO text_behavior_batches(context,mode,record) VALUES (?,?,?)',
                (encoded(context), mode, encoded({'episodes': episodes, 'states': states, 'source': source,
                                                  'raw_model': raw_model, 'behavior': behavior}))).lastrowid
        return {'status': 'bounded' if raw_model['search_limited'] or behavior['status'] == 'bounded' else behavior['status'],
                'batch_id': ident, 'raw_patterns': raw_model, 'behavior': behavior, 'derived_states': states,
                'evidence_retained': True,
                'scope': 'Observed text trajectories through a generic integer/text codec; no domain semantics parser.'}

    def observe(self, before, after, source, context=None, mode='character'):
        scope = self.scope(context, mode)
        self.engine.behavior.source(source)
        states = [self.encode(before), self.encode(after)]
        for text in (before, after):
            if len(self.engine.recursive_patterns.raw(text, mode)) > 256 or '<mask>' in text:
                raise ValueError('at most 256 base units and no mask in observations')
        raw_model = self.engine.recursive_text.train([dict(text=t, source=source) for t in (before, after)], scope, mode)
        behavior = self.engine.behavior.observe(*states, source, scope)
        with self.db:
            ident = self.db.execute('INSERT INTO text_behavior_batches(context,mode,record) VALUES (?,?,?)',
                (encoded(context), mode, encoded({'episodes': [[before, after]], 'states': [states], 'source': source,
                                                  'raw_model': raw_model, 'behavior': behavior}))).lastrowid
        return {'status': 'bounded' if raw_model['search_limited'] or behavior['search_limited'] else behavior['status'],
                'batch_id': ident, 'derived_states': states, 'raw_patterns': raw_model, 'behavior': behavior,
                'evidence_retained': True}

    def predict(self, text, context=None, mode='character', path=False):
        if type(path) is not bool:
            raise ValueError('boolean path flag required')
        scope = self.scope(context, mode)
        state = self.encode(text)
        result = self.engine.behavior.predict_path(state, scope) if path else self.engine.behavior.predict(state, scope)
        limited = result['search_limited']
        candidates = {}
        for candidate in result['candidates']:
            try:
                output = self.decode(candidate['state'])
                trajectories = []
                for t in candidate.get('trajectories', []):
                    trajectories.append({**t, 'texts': [self.decode(s) for s in t['states']]})
            except (ValueError, TypeError, UnicodeError):
                limited = True
                continue
            value = candidates.setdefault(output, {'text': output, 'state': candidate['state'], 'evidence': [], 'trajectories': []})
            value['evidence'].extend(candidate.get('evidence', []))
            value['trajectories'].extend(trajectories)
        return {'status': 'bounded' if limited else result['status'], 'candidates': list(candidates.values()),
                'input_state': state, 'search_limited': limited, 'verified': False,
                'scope': 'Prediction of observed text-described transformations, not unrestricted prose understanding.'}

    def inventory(self, context=None, mode='character'):
        scope = self.scope(context, mode)
        batches = [dict(batch_id=r['id'], **json.loads(r['record'])) for r in self.db.execute(
            'SELECT * FROM text_behavior_batches WHERE context=? AND mode=? ORDER BY id', (encoded(context), mode))]
        return {'batches': batches, 'models': self.engine.behavior.inventory(scope),
                'raw_patterns': self.engine.recursive_text.inventory(scope, mode),
                'scope': 'Lossless positional lexical states, not manually assigned entity/action/measurement roles.'}
