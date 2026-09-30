import json
import unittest
from knowledge import KnowledgeMemory, parse_source
from relationships import *

class RelationshipTests(unittest.TestCase):
    def setUp(self):
        self.m = KnowledgeMemory(':memory:'); self.r = RelationshipMemory(self.m)
    def tearDown(self): self.m.close()
    def add(self, text, source='test', mime='text/plain'):
        sid = self.m.ingest(parse_source(text, mime, source)); self.r.extract(sid); return sid
    def test_extraction_and_provenance(self):
        sid = self.add('Cell contains membrane.\nCell requires energy.')
        rows = self.r.query(' CELL ', 'contains')
        self.assertEqual(rows[0]['source_id'], sid)
        self.assertEqual(rows[0]['evidence'], 'Cell contains membrane.')
        self.assertFalse(rows[0]['verified'])
        self.assertTrue(self.r.supports(rows[0]))
    def test_no_negation_or_condition_guessing(self):
        self.add('Cell does not contain gold.\nCell may contains gold.\nIf cell contains gold.\nCell contains no gold.\nCell contains gold. More text.')
        self.assertFalse(self.r.query('cell'))
    def test_latest_source_only(self):
        self.add('Cell contains gold.')
        self.add('Cell contains membrane.')
        self.assertEqual([x['object'] for x in self.r.query('cell')], ['membrane'])
    def test_conflicting_sources_preserved(self):
        self.add('Cell contains gold.', 'one'); self.add('Cell contains membrane.', 'two')
        self.assertEqual(len(self.r.query('cell')), 2)
    def test_dedup(self):
        sid = self.add('Cell contains membrane.'); self.r.extract(sid)
        self.assertEqual(len(self.r.query('cell')), 1)
    def test_json_and_atomic_failure(self):
        payload = {'facts': [{'subject':'Dog','predicate':'is_a','object':'Mammal'}, {'subject':'Dog','predicate':'execute','object':'shell'}]}
        sid = self.m.ingest(parse_source(json.dumps(payload), 'application/json', 'test'))
        with self.assertRaises(ValueError): self.r.extract(sid)
        self.assertFalse(self.r.query('dog'))
        payload['facts'].pop()
        self.add(json.dumps(payload), 'good', 'application/json')
        self.assertEqual(self.r.query('dog')[0]['object'], 'mammal')
    def test_taxonomy_and_bounds(self):
        self.add('Dog is a mammal.\nMammal is an animal.\nAnimal is a dog.')
        self.assertEqual(len(self.r.taxonomy_path('dog','animal')), 2)
        self.assertIsNone(self.r.taxonomy_path('dog','animal', 1))
        self.assertIsNone(self.r.taxonomy_path('dog','missing', max_expansions=2))
        self.assertEqual(self.r.taxonomy_path('dog','dog'), [])
    def test_no_arbitrary_transitivity(self):
        self.add('Cell contains membrane.\nMembrane contains protein.')
        self.assertIsNone(self.r.taxonomy_path('cell','protein'))
    def test_verified_execution_and_memory_reuse(self):
        self.add('Cell contains membrane.')
        e = build_evidence_engine(self.r)
        b = Boundary('request','answered',2,frozenset({'read_knowledge'}))
        c = {'stage':'request','subject':'cell','predicate':'contains'}
        first = e.resolve(b,c); second = e.resolve(b,c)
        self.assertTrue(first.accepted); self.assertEqual(second.source,'memory')
        self.assertEqual(first.context['answer'][0]['object'],'membrane')
        self.assertEqual(c['stage'],'request')
        # A cached workflow retrieves fresh evidence and never replays stale text.
        self.add('Cell contains cytoplasm.')
        self.assertEqual(e.resolve(b,c).context['answer'][0]['object'],'cytoplasm')
    def test_unknown_and_permissions(self):
        e = build_evidence_engine(self.r)
        b = Boundary('request','answered',2,frozenset({'read_knowledge'}))
        self.assertFalse(e.resolve(b,{'stage':'request','subject':'unknown','predicate':'contains'}).accepted)
        self.assertFalse(e.memory)
        self.add('Cell contains membrane.')
        self.assertFalse(e.resolve(Boundary('request','answered',2), {'stage':'request','subject':'cell','predicate':'contains'}).accepted)
    def test_tamper(self):
        self.add('Cell contains membrane.')
        claim = self.r.query('cell')[0]; claim['object']='gold'
        self.assertFalse(self.r.supports(claim))

if __name__ == '__main__': unittest.main()
