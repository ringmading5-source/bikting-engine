"""Bounded English request grammar and source-backed execution; no LLM."""
import argparse
from dataclasses import dataclass, asdict
import json
import re
import unicodedata
from legacy_core import Boundary
from knowledge import KnowledgeMemory
from relationships import RelationshipMemory, build_evidence_engine, normalize

@dataclass(frozen=True)
class ParsedRequest:
    status: str
    intent: str = ''
    subject: str = ''
    predicate: str = ''
    target: str = ''
    reason: str = ''

RELATIONS = {'contain': 'contains', 'contains': 'contains', 'require': 'requires',
             'requires': 'requires', 'need': 'requires', 'needs': 'requires',
             'produce': 'produces', 'produces': 'produces'}

# Patterns are ordered and anchored. Entity normalization does not imply semantics.
ENTITY = r'([\w][\w -]{0,99}?)'
PATTERNS = [
    (rf'what (?:does|do) {ENTITY} (contain|require|need|produce)', 'lookup_verb'),
    (rf'(?:show|list) what {ENTITY} (contains|requires|needs|produces)', 'lookup_verb'),
    (rf'what is {ENTITY} (?:a |an )?(?:type|kind) of', 'lookup_type'),
    (rf'what is {ENTITY} part of', 'lookup_part'),
    (rf'(?:show|list) (?:the )?relationships (?:of|for) {ENTITY}', 'lookup_all'),
    (rf'how is {ENTITY} related to {ENTITY}', 'taxonomy'),
    (rf'is {ENTITY} (?:a|an) {ENTITY}', 'taxonomy'),
]

def entity(text):
    result = normalize(text)
    result = re.sub(r'^(?:the|a|an) ', '', result)
    forbidden = {'and','or','not','never','if','unless','except','without'}
    if not result or forbidden & set(result.split()):
        raise ValueError('compound, conditional or negated entities need clarification')
    return result

def parse_request(text):
    if not isinstance(text, str) or not text.strip():
        return ParsedRequest('unsupported', reason='Enter a nonempty question.')
    if len(text) > 500:
        return ParsedRequest('unsupported', reason='Request exceeds 500 characters.')
    if '\n' in text.strip() or ';' in text:
        return ParsedRequest('ambiguous', reason='Ask one question at a time.')
    q = ' '.join(unicodedata.normalize('NFKC', text).casefold().split())
    q = q.rstrip('?.')
    if any(x in q for x in (';', '\n')) or '?' in q:
        return ParsedRequest('ambiguous', reason='Ask one question at a time.')
    matches = []
    for pattern, kind in PATTERNS:
        match = re.fullmatch(pattern, q)
        if not match: continue
        try:
            subject = entity(match.group(1))
            if kind == 'lookup_verb': item = ParsedRequest('ready','lookup',subject,RELATIONS[match.group(2)])
            elif kind == 'lookup_type': item = ParsedRequest('ready','lookup',subject,'is_a')
            elif kind == 'lookup_part': item = ParsedRequest('ready','lookup',subject,'part_of')
            elif kind == 'lookup_all': item = ParsedRequest('ready','lookup_all',subject)
            else: item = ParsedRequest('ready','taxonomy',subject,target=entity(match.group(2)))
            matches.append(item)
        except ValueError as error:
            return ParsedRequest('ambiguous', reason=str(error))
    if len(matches) == 1: return matches[0]
    if len(matches) > 1: return ParsedRequest('ambiguous', reason='Several grammar patterns match.')
    return ParsedRequest('unsupported', reason='Supported: What does X contain/require/produce? What is X part of? What is X a type of? Show relationships of X. Is X a Y?')

class RequestProcessor:
    def __init__(self, relationships):
        self.relationships = relationships
        self.engine = build_evidence_engine(relationships)
    def handle(self, text, max_depth=4, permissions=frozenset({'read_knowledge'})):
        request = parse_request(text)
        result = {'request': asdict(request), 'status': request.status,
                  'verification_scope': 'stored source evidence, not factual truth'}
        if request.status != 'ready': return result
        if 'read_knowledge' not in permissions:
            return dict(result, status='denied', reason='read_knowledge permission required')
        if request.intent == 'taxonomy':
            path = self.relationships.taxonomy_path(request.subject, request.target, max_depth)
            if path is None:
                return dict(result, status='unknown', answer=None, reason='No supporting is_a path within bounds; this is not a negative answer.')
            # Identity is a graph equality, not a source-backed classification claim.
            if not path:
                return dict(result, status='identity', answer=request.subject, evidence=[])
            if not all(self.relationships.supports(edge) for edge in path):
                return dict(result, status='failed', reason='Evidence verification failed')
            return dict(result, status='supported', answer={'subject':request.subject,'predicate':'is_a','object':request.target}, evidence=path)
        predicates = [request.predicate] if request.intent == 'lookup' else ['is_a','contains','requires','produces','part_of']
        answers, traces = [], []
        for predicate in predicates:
            outcome = self.engine.resolve(Boundary('request','answered',2,permissions),
                {'stage':'request','subject':request.subject,'predicate':predicate})
            if outcome.accepted:
                answers.extend(outcome.context['answer'])
                traces.append({'predicate':predicate,'path':list(outcome.trace),'source':outcome.source})
        return dict(result, status='supported' if answers else 'unknown', answer=answers, execution=traces,
                    reason='Source-backed assertions retrieved.' if answers else 'No matching current source assertions; no answer invented.')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', default='knowledge.sqlite3')
    parser.add_argument('--depth', type=int, default=4)
    parser.add_argument('question')
    args = parser.parse_args()
    memory = KnowledgeMemory(args.db)
    try:
        print(json.dumps(RequestProcessor(RelationshipMemory(memory)).handle(args.question, args.depth), ensure_ascii=False, indent=2))
    finally: memory.close()
