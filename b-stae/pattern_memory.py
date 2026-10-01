"""Lossless sequence memory and evidence-backed structural analogies.

All contiguous patterns remain addressable through stored sequences; they are
not eagerly expanded into O(n^2) separate objects. No semantic understanding is
claimed. One algorithm operates on any JSON scalar sequence, with typed levels.
"""
import json
import re
from collections import Counter


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False, sort_keys=True)


def shape(sequence):
    identities = {}
    return [identities.setdefault(encoded(x), len(identities)) for x in sequence]


class PatternMemory:
    def __init__(self, engine):
        self.db = engine.db
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS pattern_observations (
          id INTEGER PRIMARY KEY, source TEXT NOT NULL, context TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS pattern_sequences (
          id INTEGER PRIMARY KEY, observation INTEGER NOT NULL,
          level TEXT NOT NULL, units TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS pattern_level ON pattern_sequences(level);
        CREATE TABLE IF NOT EXISTS pattern_examples (
          id INTEGER PRIMARY KEY, level TEXT NOT NULL, before_units TEXT NOT NULL,
          after_units TEXT NOT NULL, source TEXT NOT NULL, context TEXT NOT NULL);
        ''')

    @staticmethod
    def validate(units):
        if not isinstance(units, list) or any(type(x) not in (str, int, float, bool, type(None)) for x in units):
            raise ValueError('units must be a list of JSON scalars')
        encoded(units)

    def observe(self, units, level, source, context=None):
        self.validate(units)
        if not isinstance(level, str) or not level or not isinstance(source, str) or not source.strip():
            raise ValueError('level and source required')
        with self.db:
            obs = self.db.execute('INSERT INTO pattern_observations(source,context) VALUES (?,?)',
                                  (source, encoded(context))).lastrowid
            self.db.execute('INSERT INTO pattern_sequences(observation,level,units) VALUES (?,?,?)',
                            (obs, level, encoded(units)))
        return obs

    def observe_text(self, text, source, context=None):
        if not isinstance(text, str) or not isinstance(source, str) or not source.strip():
            raise ValueError('text and source required')
        # Explicit boundary adapters; pattern matching itself is level-neutral.
        levels = {'byte': list(text.encode('utf-8')), 'character': list(text),
                  'word': re.findall(r'\w+|[^\w\s]', text, re.UNICODE),
                  'sentence': re.findall(r'[^.!?]+[.!?]*', text)}
        with self.db:
            obs = self.db.execute('INSERT INTO pattern_observations(source,context) VALUES (?,?)',
                                  (source, encoded(context))).lastrowid
            for level, units in levels.items():
                self.db.execute('INSERT INTO pattern_sequences(observation,level,units) VALUES (?,?,?)',
                                (obs, level, encoded(units)))
        return {'observation': obs, 'levels': {k: len(v) for k, v in levels.items()}}

    def find(self, pattern, level, context=None):
        self.validate(pattern)
        if not pattern:
            raise ValueError('nonempty pattern required')
        hits = []
        for row in self.db.execute('''SELECT s.*,o.source,o.context FROM pattern_sequences s
            JOIN pattern_observations o ON o.id=s.observation WHERE level=?''', (level,)):
            if context is not None and row['context'] != encoded(context):
                continue
            units = json.loads(row['units'])
            keys, query = [encoded(x) for x in units], [encoded(x) for x in pattern]
            for start in range(len(units)-len(pattern)+1):
                if keys[start:start+len(pattern)] == query:
                    hits.append({'observation': row['observation'], 'source': row['source'],
                                 'start': start, 'end': start+len(pattern),
                                 'next': units[start+len(pattern):start+len(pattern)+1]})
        return hits

    def complete(self, prefix, level, context=None):
        self.validate(prefix)
        evidence = []
        # Keep evidence from every matching suffix, including conflicting ones.
        for start in range(len(prefix)):
            for hit in self.find(prefix[start:], level, context):
                if hit['next']:
                    evidence.append(dict(hit, matched_length=len(prefix)-start))
        counts = Counter(encoded(h['next'][0]) for h in evidence)
        candidates = [{'unit': json.loads(k), 'support': n,
                       'longest_match': max(h['matched_length'] for h in evidence if encoded(h['next'][0]) == k)}
                      for k, n in counts.items()]
        candidates.sort(key=lambda x: (-x['longest_match'], -x['support'], encoded(x['unit'])))
        return {'status': 'candidates' if candidates else 'unknown',
                'candidates': candidates, 'evidence': evidence, 'verified': False}

    def learn_pair(self, before, after, level, source, context=None):
        self.validate(before); self.validate(after)
        if not before or not isinstance(level, str) or not level or not isinstance(source, str) or not source.strip():
            raise ValueError('nonempty input, level and source required')
        # Preserve both sequences as well as the relationship demonstration.
        with self.db:
            self.observe(before, level, source, context)
            self.observe(after, level, source, context)
            ident = self.db.execute('''INSERT INTO pattern_examples
                (level,before_units,after_units,source,context) VALUES (?,?,?,?,?)''',
                (level, encoded(before), encoded(after), source, encoded(context))).lastrowid
        return ident

    def predict(self, before, level, context=None):
        self.validate(before)
        candidates = {}
        for row in self.db.execute('SELECT * FROM pattern_examples WHERE level=? AND context=?',
                                   (level, encoded(context))):
            old, after = json.loads(row['before_units']), json.loads(row['after_units'])
            if shape(old) != shape(before):
                continue
            mapping = {encoded(a): b for a, b in zip(old, before)}
            # Copy/reordering relations only; unseen constants are not invented.
            if any(encoded(x) not in mapping for x in after):
                continue
            result = [mapping[encoded(x)] for x in after]
            key = encoded(result)
            candidate = candidates.setdefault(key, {'units': result, 'evidence': []})
            candidate['evidence'].append({'example': row['id'], 'source': row['source']})
        values = sorted(candidates.values(), key=lambda x: (-len(x['evidence']), encoded(x['units'])))
        return {'status': 'unknown' if not values else 'predicted' if len(values) == 1 else 'ambiguous',
                'candidates': values, 'verified': False,
                'scope': 'equality structure and copying/reordering; no learned semantics'}

    def stats(self):
        rows = list(self.db.execute('SELECT level,units FROM pattern_sequences'))
        lengths = [len(json.loads(r['units'])) for r in rows]
        return {'sequences': len(rows), 'stored_units': sum(lengths),
                'addressable_contiguous_occurrences': sum(n*(n+1)//2 for n in lengths),
                'examples': self.db.execute('SELECT count(*) FROM pattern_examples').fetchone()[0]}
