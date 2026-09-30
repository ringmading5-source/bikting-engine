"""Deterministic, evidence-linked relationships; no arbitrary code from sources."""
import argparse
import json
import re
import unicodedata
from collections import deque
from legacy_core import Engine, State, Signature, Transition, Boundary
from knowledge import KnowledgeMemory

PREDICATES = ('is_a', 'contains', 'requires', 'produces', 'part_of')

def normalize(text):
    if not isinstance(text, str) or not text.strip():
        raise ValueError('nonempty text required')
    return ' '.join(unicodedata.normalize('NFKC', text).casefold().split())

class RelationshipMemory:
    def __init__(self, knowledge):
        self.knowledge = knowledge
        self.db = knowledge.db
        self.db.execute('''CREATE TABLE IF NOT EXISTS relationships (
            id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL,
            subject TEXT NOT NULL, predicate TEXT NOT NULL, object TEXT NOT NULL,
            evidence TEXT NOT NULL, rule TEXT NOT NULL,
            UNIQUE(source_id,subject,predicate,object,evidence,rule))''')
    def extract(self, source_id):
        row = self.db.execute('SELECT * FROM sources WHERE id=?', (source_id,)).fetchone()
        if row is None: raise ValueError('unknown source')
        claims = []
        if row['mime'] == 'application/json':
            payload = json.loads(row['text'])
            if isinstance(payload, dict) and 'facts' in payload:
                if not isinstance(payload['facts'], list): raise ValueError('facts must be an array')
                for fact in payload['facts']:
                    if not isinstance(fact, dict) or set(fact) != {'subject', 'predicate', 'object'}:
                        raise ValueError('each fact must have exactly subject, predicate and object')
                    s, p, o = normalize(fact['subject']), normalize(fact['predicate']), normalize(fact['object'])
                    if p not in PREDICATES: raise ValueError('unsupported predicate: ' + p)
                    claims.append((s, p, o, json.dumps(fact, ensure_ascii=False, sort_keys=True), 'explicit-json-v1'))
        else:
            # A deliberately narrow grammar: one simple positive statement per line.
            # No guessing from arbitrary prose, headings, negations or conditional claims.
            pattern = re.compile(r'([\w -]{1,100}?) (is a|is an|contains|requires|produces|is part of) ([\w -]{1,100})\.', re.IGNORECASE)
            mapping = {'is a': 'is_a', 'is an': 'is_a', 'contains': 'contains', 'requires': 'requires', 'produces': 'produces', 'is part of': 'part_of'}
            forbidden = {'no', 'not', 'never', 'may', 'might', 'could', 'if', 'unless', 'neither', 'without', 'sometimes', 'perhaps'}
            for line in row['text'].splitlines():
                match = pattern.fullmatch(line.strip())
                if match and not forbidden & set(re.findall(r'\w+', line.casefold())):
                    s, verb, o = match.groups()
                    claims.append((normalize(s), mapping[normalize(verb)], normalize(o), line.strip(), 'simple-statement-v1'))
        # Validate the full input before any write, so malformed imports are atomic.
        with self.db:
            self.db.executemany('INSERT OR IGNORE INTO relationships(source_id,subject,predicate,object,evidence,rule) VALUES (?,?,?,?,?,?)',
                                [(source_id, *claim) for claim in claims])
        return len(claims)
    def query(self, subject, predicate=None):
        subject = normalize(subject)
        if predicate is not None and predicate not in PREDICATES: raise ValueError('unsupported predicate')
        rows = self.db.execute('''SELECT r.*, s.source, s.title, s.sha256, s.retrieved_at
            FROM relationships r JOIN sources s ON r.source_id=s.id
            WHERE r.subject=? AND (? IS NULL OR r.predicate=?)
            AND s.id=(SELECT MAX(v.id) FROM sources v WHERE v.source=s.source)
            ORDER BY r.predicate,r.object,r.source_id,r.id''', (subject, predicate, predicate))
        return [dict(row, status='source_assertion', verified=False) for row in rows]
    def supports(self, claim):
        """Checks exact stored evidence, not whether the assertion is true."""
        return any(all(row.get(k) == claim.get(k) for k in ('id','source_id','subject','predicate','object','evidence','rule','sha256','source'))
                   for row in self.query(claim['subject'], claim['predicate']))
    def taxonomy_path(self, subject, target, max_depth=4, max_expansions=1000):
        """Only is_a is treated as transitive; never compose arbitrary predicates."""
        if type(max_depth) is not int or max_depth < 0 or type(max_expansions) is not int or max_expansions < 1:
            raise ValueError('invalid graph bounds')
        subject, target = normalize(subject), normalize(target)
        queue, seen, expanded = deque([(subject, [])]), {subject}, 0
        while queue and expanded < max_expansions:
            current, path = queue.popleft(); expanded += 1
            if current == target: return path
            if len(path) >= max_depth: continue
            for edge in self.query(current, 'is_a'):
                if edge['object'] not in seen:
                    seen.add(edge['object']); queue.append((edge['object'], path + [edge]))
        return None


def build_evidence_engine(relationships):
    """Transition execution verifies retrieval provenance, never scientific truth."""
    e = Engine(knowledge=relationships.knowledge)
    def request_valid(c):
        return c.get('stage') == 'request' and isinstance(c.get('subject'), str) and bool(c['subject'].strip()) and c.get('predicate') in PREDICATES
    def collected(c):
        return c.get('stage') == 'retrieved' and bool(c.get('claims')) and all(relationships.supports(x) for x in c['claims'])
    def answer_valid(c):
        if c.get('stage') != 'answered' or not c.get('claims'): return False
        expected = [{'subject': x['subject'], 'predicate': x['predicate'], 'object': x['object'],
                     'source': x['source'], 'evidence': x['evidence'], 'source_id': x['source_id'],
                     'status': 'source_assertion'} for x in c['claims']]
        return c.get('answer') == expected and all(relationships.supports(x) for x in c['claims'])
    e.register_state(State('request', Signature(1), request_valid))
    e.register_state(State('retrieved', Signature(2), collected))
    e.register_state(State('answered', Signature(3), answer_valid))
    def retrieve(c):
        c.update(claims=relationships.query(c['subject'], c['predicate']), stage='retrieved')
    def render(c):
        c['answer'] = [{'subject': x['subject'], 'predicate': x['predicate'], 'object': x['object'],
                        'source': x['source'], 'evidence': x['evidence'], 'source_id': x['source_id'],
                        'status': 'source_assertion'} for x in c['claims']]
        c['stage'] = 'answered'
    e.register_action('retrieve_claims', retrieve)
    e.register_action('render_evidence', render)
    e.register_transition(Transition('01_retrieve', 'request', 'retrieved', 'retrieve_claims', frozenset({'read_knowledge'})))
    e.register_transition(Transition('02_render', 'retrieved', 'answered', 'render_evidence'))
    return e

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', default='knowledge.sqlite3')
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('extract').add_argument('source_id', type=int)
    learn = sub.add_parser('learn'); learn.add_argument('source'); learn.add_argument('--web', action='store_true')
    ask = sub.add_parser('ask'); ask.add_argument('subject'); ask.add_argument('predicate', choices=PREDICATES)
    path = sub.add_parser('path'); path.add_argument('subject'); path.add_argument('target'); path.add_argument('--depth', type=int, default=4)
    args = parser.parse_args()
    memory = KnowledgeMemory(args.db)
    try:
        relationships = RelationshipMemory(memory)
        if args.command == 'learn':
            sid = memory.ingest_web(args.source) if args.web else memory.ingest_file(args.source)
            result = {'source_id': sid, 'matched_assertions': relationships.extract(sid)}
        elif args.command == 'extract': result = {'matched_assertions': relationships.extract(args.source_id)}
        elif args.command == 'path': result = {'path': relationships.taxonomy_path(args.subject, args.target, args.depth), 'status': 'source_assertion_chain'}
        else:
            engine = build_evidence_engine(relationships)
            outcome = engine.resolve(Boundary('request', 'answered', 2, frozenset({'read_knowledge'})),
                                     {'stage': 'request', 'subject': args.subject, 'predicate': args.predicate})
            result = {'accepted': outcome.accepted, 'reason': outcome.reason, 'answer': outcome.context.get('answer', []),
                      'verification_scope': 'retrieval and source provenance, not factual truth'}
        print(json.dumps(result, ensure_ascii=False, indent=2))
    finally: memory.close()
