import copy
import json
import tempfile
import unittest
from engine import Engine
from app import Application
from representation import represent


def fixture(code='111'):
    timing = {'start_ms': 0, 'duration_ms': 1000}
    values = [('caption', 'text', 'Move'), ('sound', 'voice', {'audio': {'samples': [0, 1, -1], 'sample_rate': 8000}}), ('object', 'visual', {'position': [0, 0, 0]})]
    return {'version': 1, 'sequence': [{'id': name, 'modality': modality, 'value': value, 'timing': dict(timing), 'position': None} for name, modality, value in values], 'relationships': [{'from': 'caption', 'to': 'sound', 'kind': 'synchronized'}, {'from': 'sound', 'to': 'object', 'kind': 'synchronized'}], 'output_code': code}


def steps():
    return [{'item': 'caption', 'intent': 'append " right"', 'expected': 'Move right'}, {'item': 'sound', 'intent': 'shift samples by 1', 'expected': {'audio': {'samples': [1, 2, 0], 'sample_rate': 8000}}}, {'item': 'object', 'intent': 'move by 1,0,0', 'expected': {'position': [1, 0, 0]}}]


class RepresentationTests(unittest.TestCase):
    def setUp(self):
        self.engine = Engine(database=':memory:')
        self.app = Application(self.engine)
    def tearDown(self): self.engine.close()
    def test_roundtrip_and_explicit_text_type(self):
        from core import BinaryState
        state = fixture(); state['sequence'][0]['value'] = '#abcdef é 🤔'
        encoded = represent(state)
        self.assertEqual(json.loads(BinaryState.decode(bytes.fromhex(encoded['state_hex'])).get(1).payload), state)
        result = self.engine.representations.transition(state, [{'item': 'caption', 'intent': 'append "!"', 'expected': '#abcdef é 🤔!'}])
        self.assertTrue(result['verified'])
        self.assertEqual(state['sequence'][0]['value'], '#abcdef é 🤔')
    def test_synchronized_transition_api(self):
        state = fixture(); original = copy.deepcopy(state)
        result = self.app.dispatch({'action': 'representation_transition', 'state': state, 'steps': steps()})
        self.assertEqual(state, original)
        self.assertEqual(len(result['outputs']), 3)
        self.assertEqual(len({json.dumps(i['timing'], sort_keys=True) for i in result['outputs']}), 1)
        self.assertEqual(self.app.dispatch({'action': 'representation_trajectory', 'trajectory_id': result['trajectory_id']}), result)
        self.assertEqual(self.engine.representations.transition(state, steps()), result)
    def test_color_transition(self):
        state = fixture(); state['sequence'][2]['value'] = '#101010'
        event = self.engine.representations.transition(state, [{'item': 'object', 'intent': 'brighten 1', 'expected': '#111111'}])
        self.assertEqual(event['state']['sequence'][2]['value'], '#111111')
    def test_all_routes(self):
        for route in range(8):
            result = self.engine.representations.transition(fixture(format(route, '03b')), steps())
            self.assertEqual({i['modality'] for i in result['outputs']}, {m for m, bit in [('text', 1), ('voice', 2), ('visual', 4)] if route & bit})
    def test_failure_does_not_store_or_mutate(self):
        state = fixture(); bad = steps(); bad[-1]['expected'] = {'position': [999, 0, 0]}
        with self.assertRaises(ValueError): self.engine.representations.transition(state, bad)
        self.assertEqual(state, fixture())
        self.assertEqual(self.engine.db.execute('SELECT COUNT(*) FROM representation_trajectories').fetchone()[0], 0)
    def test_bounds_and_bad_schemas(self):
        for mutate in [lambda s: s.update(version=2), lambda s: s.update(output_code='999'), lambda s: s['sequence'][1].update(id='caption'), lambda s: s['sequence'][0]['timing'].update(start_ms=-1), lambda s: s['relationships'][0].update(to='missing'), lambda s: s['sequence'][1]['timing'].update(start_ms=1), lambda s: s['sequence'][0].update(modality='unknown')]:
            state = fixture(); mutate(state)
            with self.assertRaises(ValueError): represent(state)
        with self.assertRaises(ValueError): self.engine.representations.transition(fixture(), steps(), 2)
    def test_restart_and_corruption(self):
        with tempfile.TemporaryDirectory() as directory:
            engine = Engine(database=directory + '/memory.sqlite3')
            result = engine.representations.transition(fixture(), steps()); engine.close()
            engine = Engine(database=directory + '/memory.sqlite3')
            self.assertEqual(engine.representations.get(result['trajectory_id']), result)
            engine.db.execute('UPDATE representation_trajectories SET event=?', (json.dumps(dict(result, verified=False)),))
            with self.assertRaises(ValueError): engine.representations.get(result['trajectory_id'])
            engine.close()

if __name__ == '__main__': unittest.main()
