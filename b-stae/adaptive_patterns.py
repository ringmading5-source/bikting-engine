"""Incremental, bounded induction of numerical sequence rewrites.

Pairs are supervised. The hypothesis language is copying/reordering with observed
literals, not arbitrary semantics. Contradictions and older hypotheses persist.
"""
import itertools
import json
from internal_state_learning import linked_templates
from pattern_memory import encoded
from text_relationship_learning import bind, render


class AdaptivePatterns:
    WINDOW = 16
    MAX_MODELS = 128
    MAX_REPLAY = 128

    def __init__(self, engine):
        self.engine = engine
        self.db = engine.db
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS adaptive_examples
          (id INTEGER PRIMARY KEY, context TEXT NOT NULL, mode TEXT NOT NULL, record TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS adaptive_example_context ON adaptive_examples(context,mode);
          CREATE TABLE IF NOT EXISTS adaptive_models
          (id INTEGER PRIMARY KEY, context TEXT NOT NULL, mode TEXT NOT NULL, model TEXT NOT NULL,
           UNIQUE(context,mode,model));
          CREATE TABLE IF NOT EXISTS adaptive_assessments
          (model_id INTEGER NOT NULL, example_id INTEGER NOT NULL, outcome TEXT NOT NULL,
           PRIMARY KEY(model_id,example_id));
          CREATE TABLE IF NOT EXISTS adaptive_limits
          (context TEXT NOT NULL, mode TEXT NOT NULL, PRIMARY KEY(context,mode));
        ''')

    def rows(self, table, context, mode):
        return list(self.db.execute('SELECT * FROM '+table+' WHERE context=? AND mode=? ORDER BY id',
                                    (encoded(context), mode)))

    def raw(self, text, mode):
        units = self.engine.recursive_patterns.raw(text, mode)
        if len(units) > 256:
            raise ValueError('up to 256 base units required for adaptive alignment')
        return units

    def apply(self, model, raw):
        bindings, limited = bind(model['input'], raw)
        return [render(model['output'], b) for b in bindings], limited

    def assess(self, model_id, model, row, mode):
        example = json.loads(row['record'])
        outputs, limited = self.apply(model, self.raw(example['before'], mode))
        outcome = ('bounded' if limited else 'inapplicable' if not outputs else
                   'supports' if self.raw(example['after'], mode) in outputs else 'contradicts')
        self.db.execute('INSERT OR IGNORE INTO adaptive_assessments VALUES (?,?,?)',
                        (model_id, row['id'], outcome))
        return limited

    def observe(self, before, after, source, context=None, mode='character'):
        raw = self.raw(before, mode)
        self.raw(after, mode)
        if not isinstance(source, str) or not 1 <= len(source) <= 256:
            raise ValueError('source of 1..256 characters required')
        prior = self.rows('adaptive_examples', context, mode)
        existing = self.rows('adaptive_models', context, mode)
        new_models = []
        limited = False
        attempted = 0
        with self.db:
            ident = self.db.execute('INSERT INTO adaptive_examples(context,mode,record) VALUES (?,?,?)',
                (encoded(context), mode, encoded(dict(before=before, after=after, source=source)))).lastrowid
            self.engine.boundary_states.observe(raw, {'example_id': ident}, source,
                                                ['adaptive-evidence', context], mode, ident)
            current = self.db.execute('SELECT * FROM adaptive_examples WHERE id=?', (ident,)).fetchone()
            for row in existing:
                limited |= self.assess(row['id'], json.loads(row['model']), current, mode)
            # Examine triples containing the new observation. No supplied family labels.
            # Recent window is a search budget; all older evidence remains stored.
            limited |= len(prior) > self.WINDOW
            for pair in itertools.combinations(prior[-self.WINDOW:], 2):
                examples = [json.loads(r['record']) for r in (*pair, current)]
                if len({e['before'] for e in examples}) < 3:
                    continue
                xs = [self.raw(e['before'], mode) for e in examples]
                ys = [self.raw(e['after'], mode) for e in examples]
                for method in ('boundary', 'lcs'):
                    attempted += 1
                    model, bounded = linked_templates(xs, ys, method)
                    limited |= bounded
                    if model is None:
                        continue
                    # Deduplicate the rule independently of its inducing triple/method.
                    value = encoded(model)
                    if self.db.execute('SELECT 1 FROM adaptive_models WHERE context=? AND mode=? AND model=?',
                                       (encoded(context), mode, value)).fetchone():
                        continue
                    if len(existing) + len(new_models) >= self.MAX_MODELS:
                        limited = True
                        continue
                    model_id = self.db.execute('INSERT INTO adaptive_models(context,mode,model) VALUES (?,?,?)',
                                               (encoded(context), mode, value)).lastrowid
                    new_models.append(model_id)
                    replay = prior + [current]
                    limited |= len(replay) > self.MAX_REPLAY
                    for row in replay[-self.MAX_REPLAY:]:
                        limited |= self.assess(model_id, model, row, mode)
            if limited:
                self.db.execute('INSERT OR IGNORE INTO adaptive_limits VALUES (?,?)', (encoded(context), mode))
        return {'status': 'bounded' if limited else 'adapted' if new_models else 'observed',
                'example_id': ident, 'new_models': new_models,
                'models_retained': len(existing) + len(new_models), 'hypotheses_attempted': attempted,
                'evidence_retained': True, 'search_limited': limited,
                'scope': 'Incremental supervised numerical sequence rewriting; no raw-text fact discovery.'}

    def inventory(self, context=None, mode='character'):
        if mode not in ('character', 'byte'):
            raise ValueError('character or byte mode required')
        result = []
        for row in self.rows('adaptive_models', context, mode):
            evidence = {kind: [] for kind in ('supports', 'contradicts', 'inapplicable', 'bounded')}
            for assessment in self.db.execute('SELECT * FROM adaptive_assessments WHERE model_id=? ORDER BY example_id', (row['id'],)):
                evidence[assessment['outcome']].append(assessment['example_id'])
            result.append({'model_id': row['id'], 'model': json.loads(row['model']), 'evidence': evidence})
        return result

    def predict(self, text, context=None, mode='character'):
        raw = self.raw(text, mode)
        outputs = {}
        limited = bool(self.db.execute('SELECT 1 FROM adaptive_limits WHERE context=? AND mode=?',
                                       (encoded(context), mode)).fetchone())
        def add(text, evidence):
            outputs.setdefault(text, {'text': text, 'evidence': []})['evidence'].append(evidence)
        retrieval = self.engine.boundary_states.search(raw, ['adaptive-evidence', context], mode)
        limited |= retrieval['search_limited']
        for match in retrieval['matches']:
            ident = match['payload']['example_id']
            row = self.db.execute('SELECT record FROM adaptive_examples WHERE id=?', (ident,)).fetchone()
            add(json.loads(row['record'])['after'], {'kind': 'observed', 'example_id': ident})
        models = self.inventory(context, mode)
        for item in models:
            # Three distinct supporting inputs, rather than repeated observations,
            # are needed before an induced rule can generalize.
            supported = item['evidence']['supports']
            distinct = set()
            for ident in supported:
                row = self.db.execute('SELECT record FROM adaptive_examples WHERE id=?', (ident,)).fetchone()
                distinct.add(json.loads(row['record'])['before'])
            if len(distinct) < 3:
                continue
            candidates, bounded = self.apply(item['model'], raw)
            limited |= bounded or bool(item['evidence']['bounded'])
            for numbers in candidates:
                try:
                    output = bytes(numbers).decode('utf-8') if mode == 'byte' else ''.join(chr(n) for n in numbers)
                except (ValueError, UnicodeDecodeError):
                    limited = True
                    continue
                add(output, {'kind': 'induced', 'model_id': item['model_id'],
                             'supporting_examples': supported,
                             'contradicting_examples': item['evidence']['contradicts']})
        return {'status': 'bounded' if limited else 'predicted' if len(outputs) == 1 else 'ambiguous' if outputs else 'unknown',
                'candidates': list(outputs.values()), 'models_tested': len(models),
                'search_limited': limited, 'verified': False,
                'scope': 'All applicable retained hypotheses; agreement is not proof of correctness.'}
