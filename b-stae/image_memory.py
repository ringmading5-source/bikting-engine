"""Learn uniform pixel byte programs; image geometry stays outside pixel matching."""
import hashlib
import json
from core import BinaryState, Record, RGB
from byte_relationships import Relationship
from learning import infer_rule

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

class ImageMemory:
    def __init__(self, engine):
        self.db = engine.db
        self.db.execute('''CREATE TABLE IF NOT EXISTS image_programs (
            fingerprint TEXT PRIMARY KEY, program BLOB NOT NULL, program_hash TEXT NOT NULL,
            observations TEXT NOT NULL, report TEXT NOT NULL)''')

    def observe(self, observations):
        if not isinstance(observations, dict) or set(observations) != {'training','validation'}:
            raise ValueError('training and validation image pairs required')
        fingerprint = hashlib.sha256(json.dumps(observations, sort_keys=True, separators=(',',':')).encode()).hexdigest()
        row = self.db.execute('SELECT report FROM image_programs WHERE fingerprint=?',(fingerprint,)).fetchone()
        if row: return dict(json.loads(row[0]), cached=True)
        splits = {}; entries = {}
        for split, minimum in [('training',2),('validation',1)]:
            items = observations[split]
            if not isinstance(items,list) or not minimum <= len(items) <= 10:
                raise ValueError('2..10 training and 1..10 held-out validation images required')
            pairs=[]; entries[split]=set()
            for item in items:
                if not isinstance(item,dict) or set(item) != {'before','after'}:
                    raise ValueError('before and after images required')
                w,h,a=image_state(item['before']); x,y,b=image_state(item['after'])
                if (w,h)!=(x,y): raise ValueError('pixel program preserves image dimensions')
                entries[split].add((w,h,a))
                pairs.extend((pixel(a[i:i+3]),pixel(b[i:i+3])) for i in range(0,len(a),3))
            splits[split]=pairs
        if len(entries['training'])<2 or entries['training'] & entries['validation']:
            raise ValueError('distinct training and held-out validation images required')
        train_inputs={a.encode() for a,b in splits['training']}
        if len(train_inputs)<2 or not any(a.encode() not in train_inputs for a,b in splits['validation']):
            raise ValueError('validation requires an unseen pixel input')
        rule,hypotheses=infer_rule(splits['training'],1)
        for a,b in splits['training']+splits['validation']:
            if rule.apply(a).encode()!=b.encode(): raise ValueError('pixel program fails observed image bytes')
        raw=rule.encode()
        report={'status':'learned','model':fingerprint,'hypotheses':hypotheses,
                'training_pixels':len(splits['training']),'validation_pixels':len(splits['validation']),
                'scope':'uniform independent RGB pixel transformation; unseen images remain predictions'}
        with self.db:
            self.db.execute('INSERT INTO image_programs VALUES (?,?,?,?,?)',
                (fingerprint,raw,hashlib.sha256(raw).hexdigest(),json.dumps(observations),json.dumps(report)))
        return report

    def transform(self, image, model):
        w,h,raw=image_state(image)
        row=self.db.execute('SELECT program,program_hash FROM image_programs WHERE fingerprint=?',(model,)).fetchone()
        if row is None: raise ValueError('unknown image program')
        program=bytes(row[0])
        if hashlib.sha256(program).hexdigest()!=row[1]: raise ValueError('corrupt image program')
        rule=Relationship.decode(program)
        # Whole result is built before returning: overflow or a guard failure rejects it.
        output=b''.join(rule.apply(pixel(raw[i:i+3])).get(1).payload for i in range(0,len(raw),3))
        return {'status':'transformed','image':{'width':w,'height':h,'rgb_hex':output.hex()},
                'model':model,'input_sha256':hashlib.sha256(raw).hexdigest(),
                'output_sha256':hashlib.sha256(output).hexdigest(),'bytes_processed':len(raw),
                'before_preview':raw[:48].hex(' '),'after_preview':output[:48].hex(' ')}
