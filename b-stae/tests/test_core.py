import unittest
from legacy_core import *
from legacy_demo import make_engine

class CoreTests(unittest.TestCase):
    def boundary(self, depth=2, constraints=frozenset({'execute'})):
        return Boundary('raw', 'finished', depth, constraints)
    def test_composition_then_memory(self):
        e = make_engine()
        b = self.boundary()
        self.assertEqual(e.resolve(b, {'stage': 0}).source, 'composition')
        result = e.resolve(b, {'stage': 0})
        self.assertTrue(result.accepted)
        self.assertEqual(result.source, 'memory')
        self.assertEqual(e.reinforcements[e.key(b)], 2)
    def test_constraint_and_depth(self):
        for b in (self.boundary(1), self.boundary(constraints=frozenset())):
            e = make_engine()
            self.assertFalse(e.resolve(b, {'stage': 0}).accepted)
            self.assertFalse(e.memory)
    def test_bad_entry(self):
        e = make_engine()
        self.assertFalse(e.resolve(self.boundary(), {'stage': 99}).accepted)
        self.assertFalse(e.memory)
    def test_failed_action_rolls_back_and_alternate_path(self):
        e = make_engine()
        e.register_action('bad', lambda c: c.update(stage=99))
        e.register_transition(Transition('00_bad', 'raw', 'finished', 'bad'))
        context = {'stage': 0}
        result = e.resolve(self.boundary(), context)
        self.assertTrue(result.accepted)
        self.assertEqual(context, {'stage': 0})
        self.assertEqual(result.trace, ('01_prepare', '02_finish'))
    def test_duplicate(self):
        with self.assertRaises(ValueError):
            make_engine().register_action('finish', lambda c: None)
    def test_representation_roundtrip(self):
        d = RepresentationDictionary()
        values = dict.fromkeys(GATES)
        values['visual'] = {'rgb': [255, 128, 0]}
        values['text'] = '你好'
        s = d.pack(values, 513)
        self.assertEqual(s.value >> 48, 513)
        for offset, g in enumerate(GATES):
            self.assertEqual(d.decode(g, (s.value >> (offset*8)) & 255), values[g])
    def test_dictionary_exhaustion(self):
        d = RepresentationDictionary()
        for n in range(256): d.encode('text', n)
        with self.assertRaises(OverflowError): d.encode('text', 256)
    def test_signature(self):
        self.assertEqual(Signature(15, 3).distance(Signature(0)), 2)
        with self.assertRaises(ValueError): Signature(-1)
    def test_zero_depth_identity(self):
        e = make_engine()
        self.assertTrue(e.resolve(Boundary('raw', 'raw', 0), {'stage': 0}).accepted)
    def test_budget(self):
        e = make_engine()
        self.assertFalse(e.resolve(Boundary('raw', 'finished', 2, frozenset({'execute'}), 1), {'stage': 0}).accepted)
    def test_inhibited(self):
        e = make_engine()
        e.register_action('direct', lambda c: c.update(stage=2))
        e.register_transition(Transition('00_direct', 'raw', 'finished', 'direct', inhibited=frozenset({'stop'})))
        self.assertFalse(e.resolve(Boundary('raw', 'finished', 1, frozenset({'stop'})), {'stage': 0}).accepted)

if __name__ == '__main__': unittest.main()
