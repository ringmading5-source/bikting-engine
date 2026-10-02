"""Learn state transformations and recurring transformation paths from evidence.

Named state boundaries/types are supplied. No domain facts or action rules are
installed. The generic hypothesis language is deliberately finite and explicit.
"""
import itertools
import json
from internal_state_learning import linked_templates
from pattern_memory import encoded
from relationship_discovery import numeric_fragments, apply as numeric_apply
from text_relationship_learning import bind, render


class KnowledgeBehavior:
    WINDOW = 12
    MAX_MODELS = 128
    MAX_PROGRAMS = 64
    MAX_PATHS = 32

    def __init__(self, engine):
        self.engine = engine
        self.db = engine.db
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS behavior_observations
        (id INTEGER PRIMARY KEY, context TEXT NOT NULL, record TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS behavior_models
        (id INTEGER PRIMARY KEY, context TEXT NOT NULL, program TEXT NOT NULL, UNIQUE(context,program));
        CREATE TABLE IF NOT EXISTS behavior_episodes
        (id INTEGER PRIMARY KEY, context TEXT NOT NULL, record TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS behavior_paths
        (id INTEGER PRIMARY KEY, context TEXT NOT NULL, path TEXT NOT NULL, UNIQUE(context,path));
        CREATE TABLE IF NOT EXISTS behavior_limits
        (context TEXT PRIMARY KEY);
        ''')

    def state(self, state):
        if not isinstance(state, dict) or not 1 <= len(state) <= 6:
            raise ValueError('1..6 state fields required')
        for key, value in state.items():
            if not isinstance(key, str) or not 1 <= len(key) <= 64:
                raise ValueError('bounded field labels required')
            if type(value) not in (int, str) or (type(value) is int and abs(value) > 10**9) or (type(value) is str and not 1 <= len(value) <= 128):
                raise ValueError('bounded integer or nonempty string state values required')
        return state

    def source(self, source):
        if not isinstance(source, str) or not 1 <= len(source) <= 256:
            raise ValueError('bounded source required')

    def rows(self, table, context):
        return list(self.db.execute('SELECT * FROM '+table+' WHERE context=? ORDER BY id', (encoded(context),)))

    def synthesize(self, examples):
        before = [e['before'] for e in examples]
        after = [e['after'] for e in examples]
        if any(set(s) != set(before[0]) for s in before) or any(set(s) != set(after[0]) for s in after):
            return [], False
        # Constant observed strings become applicability conditions, not supplied
        # task labels. Varying entities need not be memorized as conditions.
        guards = {k: before[0][k] for k in before[0] if type(before[0][k]) is str and all(s[k] == before[0][k] for s in before)}
        fields = {}
        alignment_limited = False
        numeric = [k for k in before[0] if all(type(s[k]) is int for s in before)]
        for target in sorted(after[0]):
            ys = [s[target] for s in after]
            options = []
            for key in sorted(before[0]):
                xs = [s[key] for s in before]
                if all(type(x) is type(y) and x == y for x, y in zip(xs, ys)):
                    options.append({'kind': 'copy', 'field': key})
                if all(type(x) is int for x in xs) and all(type(y) is int for y in ys) and len(set(xs)) >= 3:
                    for part in numeric_fragments(xs, ys):
                        coefficients = list(part['coefficients'])
                        while len(coefficients) > 1 and coefficients[-1][0] == 0:
                            coefficients.pop()
                        # Restrict this experiment to affine unary behavior.
                        if len(coefficients) <= 2:
                            options.append({'kind': 'affine', 'field': key, 'coefficients': coefficients})
                if all(type(x) is str for x in xs) and all(type(y) is str for y in ys) and len(set(xs)) >= 3:
                    for method in ('boundary', 'lcs'):
                        template, bounded = linked_templates([[ord(c) for c in x] for x in xs], [[ord(c) for c in y] for y in ys], method)
                        alignment_limited |= bounded
                        if template is not None:
                            options.append({'kind': 'sequence', 'field': key, **template})
            if all(type(y) is int for y in ys):
                for x, y in itertools.product(numeric, repeat=2):
                    if x == y:
                        continue
                    for operator in ('add', 'subtract', 'multiply'):
                        values = [s[x]+s[y] if operator == 'add' else s[x]-s[y] if operator == 'subtract' else s[x]*s[y] for s in before]
                        if len({(s[x], s[y]) for s in before}) >= 3 and values == ys:
                            options.append({'kind': operator, 'left': x, 'right': y})
            if len({encoded(v) for v in ys}) == 1:
                options.append({'kind': 'constant', 'value': ys[0]})
            # A fitted identity and a copy have identical behavior; normalize them.
            normalized = []
            for option in options:
                if option['kind'] == 'affine' and option['coefficients'] == [[0, 1], [1, 1]]:
                    option = {'kind': 'copy', 'field': option['field']}
                normalized.append(option)
            fields[target] = [json.loads(s) for s in sorted({encoded(o) for o in normalized})]
        if not all(fields.values()):
            return [], alignment_limited
        models = []
        limited = alignment_limited
        for i, choices in enumerate(itertools.product(*fields.values())):
            if i >= self.MAX_PROGRAMS:
                limited = True
                break
            program = {'schema': {k: type(v).__name__ for k, v in before[0].items()},
                       'guards': guards, 'fields': dict(zip(fields, choices))}
            if all(self.apply(program, e['before'])[0] == e['after'] for e in examples):
                models.append(program)
        return models, limited

    def apply(self, program, state):
        if {k: type(v).__name__ for k, v in state.items()} != program['schema'] or any(state[k] != v for k, v in program['guards'].items()):
            return None, False
        result = {}
        limited = False
        try:
            for target, part in program['fields'].items():
                kind = part['kind']
                if kind == 'copy':
                    value = state[part['field']]
                elif kind == 'constant':
                    value = part['value']
                elif kind == 'affine':
                    value = numeric_apply([{'kind': 'polynomial', 'coefficients': part['coefficients']}], [state[part['field']]])[0]
                    if type(value) is not int:
                        return None, False
                elif kind in ('add', 'subtract', 'multiply'):
                    x, y = state[part['left']], state[part['right']]
                    value = x+y if kind == 'add' else x-y if kind == 'subtract' else x*y
                else:
                    matches, bounded = bind(part['input'], [ord(c) for c in state[part['field']]])
                    limited |= bounded
                    values = {''.join(chr(n) for n in render(part['output'], b)) for b in matches}
                    if len(values) != 1:
                        return None, limited or bool(values)
                    value = values.pop()
                result[target] = value
            self.state(result)
        except (ValueError, OverflowError):
            return None, True
        return result, limited

    def observe(self, before, after, source, context=None):
        self.state(before); self.state(after); self.source(source)
        prior = self.rows('behavior_observations', context)
        new_models = []
        limited = len(prior) > self.WINDOW
        record = dict(before=before, after=after, source=source)
        with self.db:
            ident = self.db.execute('INSERT INTO behavior_observations(context,record) VALUES (?,?)', (encoded(context), encoded(record))).lastrowid
            for pair in itertools.combinations(prior[-self.WINDOW:], 2):
                examples = [json.loads(r['record']) for r in pair] + [record]
                if len({encoded(e['before']) for e in examples}) < 3:
                    continue
                models, bounded = self.synthesize(examples)
                limited |= bounded
                for program in models:
                    value = encoded(program)
                    if self.db.execute('SELECT 1 FROM behavior_models WHERE context=? AND program=?', (encoded(context), value)).fetchone():
                        continue
                    if len(self.rows('behavior_models', context)) >= self.MAX_MODELS:
                        limited = True
                        continue
                    model_id = self.db.execute('INSERT INTO behavior_models(context,program) VALUES (?,?)', (encoded(context), value)).lastrowid
                    new_models.append(model_id)
            if limited:
                self.db.execute('INSERT OR IGNORE INTO behavior_limits VALUES (?)', (encoded(context),))
        return {'status': 'bounded' if limited else 'learned' if new_models else 'observed', 'observation': ident,
                'new_models': new_models, 'evidence_retained': True, 'search_limited': limited}

    def inventory(self, context=None):
        observations = self.rows('behavior_observations', context)
        models = []
        for row in self.rows('behavior_models', context):
            program = json.loads(row['program'])
            support = []; conflicts = []; distinct = set(); limited = False
            for obs in observations:
                e = json.loads(obs['record']); output, bounded = self.apply(program, e['before']); limited |= bounded
                if output is None:
                    continue
                if output == e['after']:
                    support.append(obs['id']); distinct.add(encoded(e['before']))
                else:
                    conflicts.append(obs['id'])
            models.append({'model_id': row['id'], 'program': program, 'support': support, 'conflicts': conflicts,
                           'eligible': len(distinct) >= 3, 'search_limited': limited})
        return models

    def predict(self, state, context=None):
        self.state(state)
        candidates = {}
        limited = bool(self.db.execute('SELECT 1 FROM behavior_limits WHERE context=?', (encoded(context),)).fetchone())
        def add(value, evidence):
            candidates.setdefault(encoded(value), {'state': value, 'evidence': []})['evidence'].append(evidence)
        for row in self.rows('behavior_observations', context):
            e = json.loads(row['record'])
            if e['before'] == state:
                add(e['after'], {'kind': 'observed', 'observation': row['id'], 'source': e['source']})
        for model in self.inventory(context):
            if not model['eligible']:
                continue
            output, bounded = self.apply(model['program'], state); limited |= bounded or model['search_limited']
            if output is not None:
                add(output, {'kind': 'learned_behavior', 'model_id': model['model_id'], 'support': model['support'], 'conflicts': model['conflicts']})
        values = list(candidates.values())
        return {'status': 'bounded' if limited else 'predicted' if len(values) == 1 else 'ambiguous' if values else 'unknown',
                'candidates': values, 'search_limited': limited, 'verified': False,
                'scope': 'Learned transformations of supplied observations; no causal truth verification.'}

    def learn_episodes(self, episodes, source, context=None):
        self.source(source)
        if not isinstance(episodes, list) or not 3 <= len(episodes) <= 8:
            raise ValueError('3..8 observed trajectories required')
        for episode in episodes:
            if not isinstance(episode, list) or not 3 <= len(episode) <= 5:
                raise ValueError('3..5 states per trajectory required')
            for value in episode:
                self.state(value)
        for episode in episodes:
            for before, after in zip(episode, episode[1:]):
                self.observe(before, after, source, context)
            with self.db:
                self.db.execute('INSERT INTO behavior_episodes(context,record) VALUES (?,?)', (encoded(context), encoded({'states': episode, 'source': source})))
        models = [m for m in self.inventory(context) if m['eligible']]
        paths = {}
        limited = False
        for row in self.rows('behavior_episodes', context):
            episode = json.loads(row['record'])['states']
            choices = [[m['model_id'] for m in models if self.apply(m['program'], x)[0] == y] for x, y in zip(episode, episode[1:])]
            for i, path in enumerate(itertools.product(*choices)):
                if i >= self.MAX_PATHS:
                    limited = True; break
                paths.setdefault(encoded(list(path)), set()).add(encoded(episode[0]))
        learned = []
        with self.db:
            for path, starts in paths.items():
                if len(starts) >= 3:
                    self.db.execute('INSERT OR IGNORE INTO behavior_paths(context,path) VALUES (?,?)', (encoded(context), path))
                    learned.append(json.loads(path))
            if limited:
                self.db.execute('INSERT OR IGNORE INTO behavior_limits VALUES (?)', (encoded(context),))
        return {'status': 'bounded' if limited else 'learned' if learned else 'unsupported', 'paths': learned,
                'evidence_retained': True, 'scope': 'Recurring sequences of learned behavior IDs supported by three distinct starting states.'}

    def predict_path(self, state, context=None):
        self.state(state)
        candidates = {}
        limited = bool(self.db.execute('SELECT 1 FROM behavior_limits WHERE context=?', (encoded(context),)).fetchone())
        assessments = {m['model_id']: m for m in self.inventory(context)}
        contested = False
        for row in self.rows('behavior_paths', context):
            path = json.loads(row['path']); trajectory = [state]
            evidence = []
            conflicts = []
            for ident in path:
                model = self.db.execute('SELECT program FROM behavior_models WHERE id=? AND context=?', (ident, encoded(context))).fetchone()
                next_state, bounded = self.apply(json.loads(model[0]), trajectory[-1]); limited |= bounded
                if next_state is None:
                    break
                trajectory.append(next_state); evidence.append(ident)
                conflicts.extend(assessments[ident]['conflicts'])
                limited |= assessments[ident]['search_limited']
            else:
                result = candidates.setdefault(encoded(trajectory[-1]), {'state': trajectory[-1], 'trajectories': []})
                contested |= bool(conflicts)
                result['trajectories'].append({'states': trajectory, 'model_ids': evidence, 'path_id': row['id'], 'conflicting_observations': sorted(set(conflicts))})
        values = list(candidates.values())
        return {'status': 'bounded' if limited else 'contested' if contested and len(values) == 1 else 'predicted' if len(values) == 1 else 'ambiguous' if values else 'unknown',
                'candidates': values, 'search_limited': limited, 'verified': False,
                'scope': 'Composition of a recurring observed path; prediction is not an observed outcome.'}
