"""Raw-text hierarchy and recurring relational frames, without supplied targets.

Frames relate variable spans through recurring numerical anchors. This is
structural language learning, not a claim of grounded semantic understanding.
"""
import itertools
import json
from internal_state_learning import boundary_pattern
from pattern_memory import encoded
from text_relationship_learning import infer_pattern, bind


class RecursiveTextPatterns:
    MAX_PAIRS = 256
    MAX_FRAMES = 128
    MAX_FILLERS = 1024
    MAX_MATCHES = 8192

    def __init__(self, engine):
        self.engine = engine
        self.db = engine.db
        self.hierarchy = engine.recursive_patterns
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS recursive_text_runs
        (id INTEGER PRIMARY KEY, context TEXT NOT NULL, mode TEXT NOT NULL, record TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS recursive_text_context ON recursive_text_runs(context,mode,id);
        ''')

    def scope(self, context):
        return ['recursive-text', context]

    def latest(self, context, mode):
        if mode not in ('character', 'byte'):
            raise ValueError('character or byte mode required')
        return self.db.execute('SELECT * FROM recursive_text_runs WHERE context=? AND mode=? ORDER BY id DESC LIMIT 1',
                               (encoded(context), mode)).fetchone()

    def train(self, observations, context=None, mode='character', include_history=True):
        if type(include_history) is not bool:
            raise ValueError('boolean include_history required')
        if not isinstance(observations, list) or not 2 <= len(observations) <= 32:
            raise ValueError('2..32 raw text/source observations required')
        for obs in observations:
            if not isinstance(obs, dict) or set(obs) != {'text', 'source'}:
                raise ValueError('text/source observations required, without output targets')
            raw = self.hierarchy.raw(obs['text'], mode)
            if len(raw) > 256 or '<mask>' in obs['text']:
                raise ValueError('up to 256 base units and no mask in training text')
            if not isinstance(obs['source'], str) or not 1 <= len(obs['source']) <= 256:
                raise ValueError('bounded source required')
        previous = self.latest(context, mode)
        history = json.loads(previous['record'])['observations'] if previous and include_history else []
        observations = history + observations
        if len(observations) > 32:
            raise ValueError('history plus batch exceeds 32 observations; earlier runs remain retained')
        scope = self.scope(context)
        discovery = self.hierarchy.learn(observations, scope, mode, rounds=64, max_depth=16, include_history=False)
        raw_sequences = [self.hierarchy.raw(o['text'], mode) for o in observations]
        levels = [('base', raw_sequences)]
        # Use the same sequence alignment at each discovered depth, not preset words.
        run = self.db.execute('SELECT model FROM recursive_runs WHERE id=?', (discovery['run_id'],)).fetchone()
        rules = json.loads(run[0])['rules']
        sequences = [[self.db.execute('SELECT id FROM recursive_units WHERE mode=? AND kind=? AND parts=?',
                                     (mode, 'atom', encoded([n]))).fetchone()[0] for n in raw] for raw in raw_sequences]
        for depth in sorted({r['depth'] for r in rules}):
            current = [list(s) for s in sequences]
            for rule in rules:
                if rule['depth'] <= depth:
                    current = [self.hierarchy.replace(s, rule['pair'], rule['unit']) for s in current]
            levels.append(('depth-'+str(depth), current))
        frames = {}
        limited = False
        # Keep older relational hypotheses and reassess them against the expanded
        # corpus. New alignments cannot silently replace an earlier pattern.
        if previous and include_history:
            for old in json.loads(previous['record'])['frames']:
                frame = dict(old, support=[], bindings=[])
                for i, raw in enumerate(raw_sequences):
                    matches, bounded = bind(frame['pattern'], raw)
                    limited |= bounded
                    if matches:
                        frame['support'].append(i)
                        frame['bindings'].append({'observation': i, 'values': matches})
                frames[encoded(frame['pattern'])] = frame
        attempts = 0
        for level, sequences in levels:
            for a, b in itertools.combinations(range(len(sequences)), 2):
                if raw_sequences[a] == raw_sequences[b]:
                    continue
                if attempts >= self.MAX_PAIRS:
                    limited = True
                    break
                attempts += 1
                for infer in (boundary_pattern, infer_pattern):
                    pattern, slots = infer([sequences[a], sequences[b]])
                    if not slots:
                        continue
                    base_pattern = []
                    for part in pattern:
                        if 'slot' in part:
                            base_pattern.append({'slot': part['slot'], 'min_tokens': 0})
                        else:
                            numbers = [part['literal']] if level == 'base' else self.hierarchy.expand(part['literal'], mode)
                            base_pattern.extend({'literal': n} for n in numbers)
                    if not any('literal' in p for p in base_pattern):
                        continue
                    key = encoded(base_pattern)
                    if key in frames:
                        if level not in frames[key]['discovered_levels']:
                            frames[key]['discovered_levels'].append(level)
                        continue
                    support = []
                    bindings = []
                    for i, raw in enumerate(raw_sequences):
                        matches, bounded = bind(base_pattern, raw)
                        limited |= bounded
                        if matches:
                            support.append(i)
                            bindings.append({'observation': i, 'values': matches})
                    if len({observations[i]['text'] for i in support}) < 3:
                        continue
                    if len(frames) >= self.MAX_FRAMES:
                        limited = True
                        continue
                    frames[key] = {'pattern': base_pattern, 'support': support, 'bindings': bindings,
                                   'discovered_levels': [level]}
        # Candidate spans come from learned constituents and recurring frame anchors
        # or observed slot bindings, rather than a supplied vocabulary/word tokenizer.
        filler_set = set()
        def retain(numbers):
            if not numbers or len(numbers) > 32:
                return
            try:
                text = bytes(numbers).decode('utf-8') if mode == 'byte' else ''.join(chr(n) for n in numbers)
            except (ValueError, UnicodeDecodeError):
                return
            if text.strip():
                filler_set.add(text)
        for rule in rules:
            retain(self.hierarchy.expand(rule['unit'], mode))
        for frame in frames.values():
            streak = []
            for part in frame['pattern'] + [{'slot': -1}]:
                if 'literal' in part:
                    streak.append(part['literal'])
                else:
                    for start in range(len(streak)):
                        for end in range(start+1, min(len(streak), start+32)+1):
                            retain(streak[start:end])
                    streak = []
            for binding in frame['bindings']:
                for values in binding['values']:
                    for numbers in values.values():
                        retain(numbers)
        fillers = sorted(filler_set, key=lambda s: (len(s), s))
        limited |= len(fillers) > self.MAX_FILLERS
        record = {'observations': observations, 'hierarchy_run': discovery['run_id'],
                  'frames': list(frames.values()), 'fillers': fillers[:self.MAX_FILLERS],
                  'search_limited': limited, 'frame_attempts': attempts}
        with self.db:
            ident = self.db.execute('INSERT INTO recursive_text_runs(context,mode,record) VALUES (?,?,?)',
                                    (encoded(context), mode, encoded(record))).lastrowid
        return {'status': 'bounded' if limited else 'learned', 'run_id': ident, 'discovery': discovery,
                'frames_discovered': len(frames), 'candidate_spans': len(record['fillers']),
                'search_limited': limited, 'evidence_retained': True,
                'scope': 'Raw numerical hierarchy plus recurring variable-span frames; no semantic labels supplied.'}

    def inventory(self, context=None, mode='character'):
        row = self.latest(context, mode)
        if row is None:
            return {'status': 'unknown', 'frames': []}
        record = json.loads(row['record'])
        hierarchy_row = self.db.execute('SELECT model FROM recursive_runs WHERE id=?', (record['hierarchy_run'],)).fetchone()
        def readable(numbers):
            try:
                return bytes(numbers).decode('utf-8') if mode == 'byte' else ''.join(chr(n) for n in numbers)
            except (ValueError, UnicodeDecodeError):
                return None
        constituents = []
        for rule in json.loads(hierarchy_row[0])['rules']:
            numbers = self.hierarchy.expand(rule['unit'], mode)
            constituents.append({**rule, 'base_numbers': numbers, 'readable': readable(numbers)})
        frames = []
        for frame in record['frames']:
            segments = []
            streak = []
            for part in frame['pattern'] + [{'slot': -1}]:
                if 'literal' in part:
                    streak.append(part['literal'])
                else:
                    if streak:
                        segments.append({'literal_text': readable(streak), 'base_numbers': streak})
                        streak = []
                    if part['slot'] != -1:
                        segments.append({'variable_span': part['slot']})
            frames.append({**frame, 'readable_structure': segments})
        coverage = {'training_observations': len(record['observations']),
                    'total_base_units': sum(len(self.hierarchy.raw(o['text'], mode)) for o in record['observations']),
                    'distinct_base_units': len({n for o in record['observations'] for n in self.hierarchy.raw(o['text'], mode)}),
                    'all_observations_retained': True,
                    'scope': 'Every input sequence is retained; recurring units are learned, not every word meaning.'}
        return {'status': 'bounded' if record['search_limited'] else 'learned', 'run_id': row['id'],
                **record, 'frames': frames, 'learned_constituents': constituents, 'coverage': coverage}

    def predict(self, text, context=None, mode='character'):
        if not isinstance(text, str) or text.count('<mask>') != 1 or len(text) > 256:
            raise ValueError('one <mask> and at most 256 characters required')
        row = self.latest(context, mode)
        if row is None:
            return {'status': 'unknown', 'candidates': [], 'preferred': [], 'verified': False}
        record = json.loads(row['record'])
        left, right = text.split('<mask>')
        limited = record['search_limited']
        candidates = []
        matches_attempted = 0
        for filler in record['fillers']:
            if matches_attempted >= self.MAX_MATCHES:
                limited = True
                break
            completed = left + filler + right
            raw = self.hierarchy.raw(completed, mode)
            if len(raw) > 256:
                limited = True
                continue
            evidence = []
            specificity = 0
            for i, frame in enumerate(record['frames']):
                if matches_attempted >= self.MAX_MATCHES:
                    limited = True
                    break
                matches_attempted += 1
                matches, bounded = bind(frame['pattern'], raw)
                limited |= bounded
                if not matches:
                    continue
                score = sum('literal' in p for p in frame['pattern'])
                specificity = max(specificity, score)
                evidence.append({'frame': i, 'literal_units': score, 'observations': frame['support'],
                                 'sources': [record['observations'][j]['source'] for j in frame['support']]})
            if evidence:
                candidates.append({'text': filler, 'completed': completed, 'specificity': specificity,
                                   'evidence': evidence})
        candidates.sort(key=lambda c: (-c['specificity'], len(c['text']), c['text']))
        # Specificity then shortest completion is a programmed heuristic, not truth.
        best = (-candidates[0]['specificity'], len(candidates[0]['text'])) if candidates else None
        preferred = [c for c in candidates if (-c['specificity'], len(c['text'])) == best]
        return {'status': 'bounded' if limited else 'predicted' if len(preferred) == 1 else 'ambiguous' if preferred else 'unknown',
                'preferred': preferred, 'candidates': candidates, 'search_limited': limited,
                'hierarchy_run': record['hierarchy_run'], 'matches_attempted': matches_attempted, 'verified': False,
                'scope': 'Structural completion of learned numerical frames, not grounded meaning.'}
