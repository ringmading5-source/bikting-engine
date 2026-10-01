"""One shared transition: caption, recorded PCM audio, and visual position."""
from engine import Engine
import json


def demo_request():
    timing = {'start_ms': 0, 'duration_ms': 1000}
    items = [('caption', 'text', 'Move'), ('sound', 'voice', {'audio': {'samples': [0, 1, -1], 'sample_rate': 8000}}), ('object', 'visual', {'position': [0, 0, 0]})]
    return {'action': 'representation_transition', 'state': {
        'version': 1, 'output_code': '111',
        'sequence': [{'id': name, 'modality': modality, 'value': value, 'timing': dict(timing), 'position': None} for name, modality, value in items],
        'relationships': [{'from': 'caption', 'to': 'sound', 'kind': 'synchronized'}, {'from': 'sound', 'to': 'object', 'kind': 'synchronized'}]},
        'steps': [{'item': 'caption', 'intent': 'append " right"', 'expected': 'Move right'}, {'item': 'sound', 'intent': 'shift samples by 1', 'expected': {'audio': {'samples': [1, 2, 0], 'sample_rate': 8000}}}, {'item': 'object', 'intent': 'move by 1,0,0', 'expected': {'position': [1, 0, 0]}}]}

if __name__ == '__main__':
    from app import Application
    engine = Engine(database=':memory:')
    try: print(json.dumps(Application(engine).dispatch(demo_request()), ensure_ascii=False, indent=2))
    finally: engine.close()
