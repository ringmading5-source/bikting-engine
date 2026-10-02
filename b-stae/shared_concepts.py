"""Small supervised cross-modal concept linker, not speech/object recognition.

Feature extraction is programmed; concept labels, exemplars and acceptance
radii come from aligned evidence. Encoders intentionally lose information.
"""
import hashlib
import json
import math
import re
from pattern_memory import encoded
from image_format import image_state

VERSION='concept-features-v1'

def normalized(vector):
    length=math.sqrt(sum(x*x for x in vector))
    return [x/length for x in vector] if length else vector

def distance(a,b):return math.sqrt(sum((x-y)**2 for x,y in zip(a,b)))

class SharedConcepts:
    encoder_version=VERSION
    def __init__(self,engine):
        self.engine,self.db=engine,engine.db
        self.db.execute('''CREATE TABLE IF NOT EXISTS shared_concept_examples
            (id INTEGER PRIMARY KEY, context TEXT NOT NULL, concept TEXT NOT NULL,
             modality TEXT NOT NULL, encoder TEXT NOT NULL, value TEXT NOT NULL,
             features TEXT NOT NULL, source TEXT NOT NULL)''')

    def encode(self,value):
        if isinstance(value,str):
            if not value.strip() or len(value)>512:raise ValueError('1..512 text characters required')
            words=re.findall(r'\w+',value.casefold())
            if not words:raise ValueError('word-bearing text required')
            vector=[0.0]*128
            for word in words:
                vector[int.from_bytes(hashlib.sha256(word.encode()).digest()[:4],'big')%128]+=1
            return 'text',normalized(vector)
        if isinstance(value,dict) and set(value)=={'image'}:
            _,_,raw=image_state(value['image'])
            # RGB means and deviations, not objects or spatial scene structure.
            channels=[list(raw[c::3]) for c in range(3)]
            means=[sum(c)/len(c)/255 for c in channels]
            deviations=[math.sqrt(sum((x/255-m)**2 for x in c)/len(c)) for c,m in zip(channels,means)]
            return 'image',means+deviations
        if isinstance(value,dict) and set(value)=={'audio'}:
            self.engine.recognize(value)
            samples=value['audio']['samples'];rate=value['audio']['sample_rate']
            if not 32<=len(samples)<=4096 or not 4000<=rate<=48000:raise ValueError('32..4096 PCM16 samples at 4..48 kHz required')
            # Fixed spectral probes: these are tone features, not an ASR encoder.
            mean=sum(samples)/len(samples)
            centered=[x-mean for x in samples]
            energy=[]
            for frequency in range(100,1700,100):
                real=sum(x*math.cos(2*math.pi*frequency*i/rate) for i,x in enumerate(centered))
                imag=sum(x*math.sin(2*math.pi*frequency*i/rate) for i,x in enumerate(centered))
                energy.append(math.hypot(real,imag))
            if max(energy)<1e-6:raise ValueError('non-silent audio required')
            return 'audio',normalized(energy)
        raise ValueError('text, RGB image or PCM16 audio required')

    def observe(self,concept,value,source,context=None):
        if not isinstance(concept,str) or not 1<=len(concept)<=128:raise ValueError('bounded shared concept label required')
        if not isinstance(source,str) or not 1<=len(source)<=512:raise ValueError('evidence source required')
        modality,features=self.encode(value)
        with self.db:
            ident=self.db.execute('INSERT INTO shared_concept_examples(context,concept,modality,encoder,value,features,source) VALUES (?,?,?,?,?,?,?)',
                (encoded(context),concept,modality,self.encoder_version,encoded(value),encoded(features),source)).lastrowid
        return {'status':'recorded','example':ident,'concept':concept,'modality':modality,'encoder':self.encoder_version}

    def predict(self,value,context=None):
        modality,features=self.encode(value)
        rows=self.db.execute('SELECT * FROM shared_concept_examples WHERE context=? AND modality=? AND encoder=? ORDER BY id LIMIT 513',
                            (encoded(context),modality,self.encoder_version)).fetchall()
        if len(rows)>512:return {'status':'bounded','reason':'512-example budget exceeded','model_calls':0}
        groups={};exact={}
        for row in rows:
            groups.setdefault(row['concept'],[]).append(row)
            if row['value']==encoded(value):exact.setdefault(row['concept'],[]).append(row['id'])
        if len(exact)>1:return {'status':'contested','concepts':sorted(exact),'evidence':exact,'modality':modality,'model_calls':0}
        candidates=[]
        for concept,examples in groups.items():
            # Repetition cannot count as independent distinct input support.
            vectors={row['value']:json.loads(row['features']) for row in examples}
            if len(vectors)<3:continue
            vectors=list(vectors.values())
            radius=max(min(distance(a,b) for j,b in enumerate(vectors) if i!=j) for i,a in enumerate(vectors))*1.25+0.02
            closest=min(distance(features,v) for v in vectors)
            if closest<=radius:
                candidates.append({'concept':concept,'distance':closest,'learned_radius':radius,
                                   'evidence':[r['id'] for r in examples]})
        candidates.sort(key=lambda c:(c['distance'],c['concept']))
        ambiguous=len(candidates)>1 and candidates[1]['distance']-candidates[0]['distance']<=0.05
        status='ambiguous' if ambiguous else 'linked' if candidates else 'unknown'
        return {'status':status,'concept':candidates[0]['concept'] if status=='linked' else None,
                'candidates':candidates,'modality':modality,'encoder':self.encoder_version,'model_calls':0,
                'scope':'supervised similarity linkage; hashed text words, RGB statistics and tone spectra; not general semantic, object or speech understanding'}

    def inspect(self,values,context=None):
        if not isinstance(values,list) or not 1<=len(values)<=8:raise ValueError('1..8 inputs required')
        predictions=[self.predict(value,context) for value in values]
        linked=all(p['status']=='linked' for p in predictions)
        concepts={p['concept'] for p in predictions if p.get('concept') is not None}
        return {'status':'aligned' if linked and len(concepts)==1 else 'mismatch' if linked else 'unresolved',
                'concept':next(iter(concepts)) if linked and len(concepts)==1 else None,
                'predictions':predictions,'model_calls':0}
