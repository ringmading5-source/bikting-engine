"""Bounded RGB format validation for explicit deterministic image tools."""
from core import BinaryState, Record, RGB

MAX_PIXELS = 4096

def image_state(value):
    if not isinstance(value, dict) or set(value) != {'width', 'height', 'rgb_hex'}:
        raise ValueError('image requires width, height and rgb_hex')
    w, h = value['width'], value['height']
    if type(w) is not int or type(h) is not int or w < 1 or h < 1 or w*h > MAX_PIXELS:
        raise ValueError('image must contain 1..4096 pixels')
    if not isinstance(value['rgb_hex'], str) or len(value['rgb_hex']) > MAX_PIXELS*6:
        raise ValueError('bounded packed RGB hex required')
    raw = bytes.fromhex(value['rgb_hex'])
    if len(raw) != w*h*3:
        raise ValueError('RGB byte count does not match dimensions')
    return w, h, raw

def pixel(raw):
    return BinaryState((Record(1, RGB, raw),))

