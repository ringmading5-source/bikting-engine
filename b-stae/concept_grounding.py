"""Limited source-definition grounding into registered geometric rendering."""
import hashlib
import json
import re
import xml.etree.ElementTree as ET
from core import BinaryState,Record,BLOB,UTF8

SHAPES={'round':'circle','spherical':'circle','circular':'circle','oval':'ellipse','ovoid':'ellipse',
        'square':'square','rectangular':'rectangle','triangular':'triangle'}

class ConceptGrounding:
    def __init__(self,engine):
        self.engine=engine;self.db=engine.db
        self.db.execute('''CREATE TABLE IF NOT EXISTS grounded_properties (
            subject TEXT NOT NULL,source_id INTEGER NOT NULL,source_hash TEXT NOT NULL,
            descriptor BLOB NOT NULL,clause TEXT NOT NULL, PRIMARY KEY(subject,source_id))''')
    def request(self,text):
        if not isinstance(text,str) or len(text)>200:raise ValueError('bounded concept request required')
        match=re.fullmatch(r'\s*(draw|show|render)\s+(?:(?:a|an|the)\s+)?([A-Za-z][A-Za-z -]{0,60})\s*',text,re.I)
        if match:return {'operation':'render_shape','subject':' '.join(match[2].lower().split())}
        return None
    def extract(self,sid,subject):
        if not isinstance(subject,str) or not re.fullmatch(r'[a-z][a-z -]{0,60}',subject):return {'status':'evidence_only'}
        row=self.db.execute('SELECT * FROM sources WHERE id=?',(sid,)).fetchone()
        if row is None:return {'status':'evidence_only'}
        text=self.engine.source_state(sid).get(1).payload.decode()
        # Only the affirmative initial definition clause of the exact subject.
        # Parenthetical qualifications are retained in source evidence but not
        # treated as instructions or as a physical appearance guarantee.
        pattern=r'(?:^|[.!?]\s+)(?:(?:a|an|the)\s+)?'+re.escape(subject)+r'\s+is\s+(?:a|an)\s+([^.!?\n]{1,250})'
        match=re.search(pattern,text,re.I)
        if not match:return {'status':'evidence_only'}
        clause=match.group(0).strip();body=match[1].split('(')[0].strip()
        if re.search(r'\b(not|never|no|may|might|possibly)\b',body,re.I):return {'status':'unsupported_definition'}
        # Require a stated category; don't interpret incidental geometry elsewhere.
        category=re.search(r'\b(object|shape|figure|solid|fruit|instrument|device|body)\b',body,re.I)
        if category is None:return {'status':'evidence_only'}
        adjectives=body[:category.start()].lower()
        shapes=sorted({shape for word,shape in SHAPES.items() if re.search(r'\b'+word+r'\b',adjectives)})
        if not shapes:return {'status':'evidence_only'}
        descriptor={'subject':subject,'relation':'is_a','category':category.group().lower(),
            'depiction_shapes':shapes,'source_id':sid,'source_hash':row['sha256'],
            'scope':'source-described geometry; illustrative 2D depiction, not physical reconstruction'}
        raw=json.dumps(descriptor,sort_keys=True,separators=(',',':')).encode()
        with self.db:self.db.execute('INSERT OR REPLACE INTO grounded_properties VALUES (?,?,?,?,?)',(subject,sid,row['sha256'],raw,clause))
        return {'status':'property_extracted','descriptor':descriptor,'clause':clause}
    def resolve(self,text):
        request=self.request(text)
        if request is None:return {'status':'unknown','reason':'No registered concept-rendering intent matches.'}
        facts=[]
        for row in self.db.execute('SELECT * FROM grounded_properties WHERE subject=? ORDER BY source_id',(request['subject'],)):
            source=self.db.execute('SELECT * FROM sources WHERE id=?',(row['source_id'],)).fetchone()
            if source is None or source['sha256']!=row['source_hash']:continue
            self.engine.source_state(row['source_id'])
            descriptor=json.loads(bytes(row['descriptor']))
            if descriptor['source_hash']!=source['sha256']:raise ValueError('concept provenance mismatch')
            facts.append({'descriptor':descriptor,'url':source['source'],'clause':row['clause']})
        shapes={shape for fact in facts for shape in fact['descriptor']['depiction_shapes']}
        if not shapes:return {'status':'unknown','reason':'No supported geometry extracted for this subject.'}
        if len(shapes)!=1:return {'status':'ambiguous','reason':'Source properties describe conflicting depiction shapes.','evidence':facts}
        shape=next(iter(shapes));svg=self.render(shape);self.verify(svg,shape)
        descriptor={'subject':request['subject'],'shape':shape,'capability':'render.2d.geometry','constraints':{'width':256,'height':256,'illustrative':True}}
        state=BinaryState((Record(1,BLOB,json.dumps(descriptor,sort_keys=True).encode()),))
        output=BinaryState((Record(1,UTF8,svg.encode()),))
        return {'status':'fulfilled','intent':request,'descriptor':descriptor,'svg':svg,'verified':True,
            'verification_scope':'SVG geometry and bounds checked; source statement is not independently proven',
            'evidence':facts,'trace':[{'stage':'word_sequence','words':[{'word':w,'hex':w.encode().hex()} for w in text.split()]},
                {'stage':'source_property','state_hex':state.encode().hex()},
                {'stage':'registered_renderer','output_sha256':hashlib.sha256(output.encode()).hexdigest(),'output_bytes':len(svg.encode())}]}
    def render(self,shape):
        elements={'circle':'<circle cx="128" cy="128" r="88"/>',
            'ellipse':'<ellipse cx="128" cy="128" rx="96" ry="64"/>',
            'square':'<rect x="40" y="40" width="176" height="176"/>',
            'rectangle':'<rect x="24" y="64" width="208" height="128"/>',
            'triangle':'<polygon points="128,32 224,224 32,224"/>'}
        return '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><g fill="#72dbbf" stroke="#11251e" stroke-width="3">'+elements[shape]+'</g></svg>'
    def verify(self,svg,shape):
        # Exact canonical renderer output, then independent primitive bounds checks.
        if svg!=self.render(shape):raise ValueError('noncanonical geometry output')
        root=ET.fromstring(svg);node=list(list(root)[0])[0];tag=node.tag.split('}')[-1]
        expected={'circle':'circle','ellipse':'ellipse','square':'rect','rectangle':'rect','triangle':'polygon'}[shape]
        if tag!=expected or root.get('viewBox')!='0 0 256 256':raise ValueError('geometry target mismatch')
        if tag in ('circle','ellipse'):
            cx,cy=float(node.get('cx')),float(node.get('cy'))
            rx=float(node.get('r') or node.get('rx'));ry=float(node.get('r') or node.get('ry'))
            points=[(cx-rx,cy-ry),(cx+rx,cy+ry)]
        elif tag=='rect':
            x,y=float(node.get('x')),float(node.get('y'));points=[(x,y),(x+float(node.get('width')),y+float(node.get('height')))]
        else:points=[tuple(map(float,p.split(','))) for p in node.get('points').split()]
        if any(not 0<=x<=256 or not 0<=y<=256 for x,y in points):raise ValueError('geometry exceeds bounds')
        return True
