"""Property-based selection of registered computational capability adapters."""
from dataclasses import dataclass
import hashlib
import io
import json
import math
import struct
import xml.etree.ElementTree as ET
from core import BinaryState,Record,BLOB,UTF8

@dataclass(frozen=True)
class Capability:
    id: str
    input_type: str
    output_type: str
    effect: str
    styles: tuple
    version: str
    execute: object

class CapabilityRegistry:
    def __init__(self,engine):
        self.engine=engine;self.db=engine.db;self.registry={}
        self.db.execute('''CREATE TABLE IF NOT EXISTS capability_paths (
            boundary TEXT PRIMARY KEY, capability TEXT NOT NULL, specification BLOB NOT NULL,
            entry BLOB NOT NULL, output_hash TEXT NOT NULL, uses INTEGER NOT NULL)''')
        self.register(Capability('matplotlib.numeric_plot','numeric_series','svg','plot_values',('line','bar'),'1',self.plot))
    def register(self,capability):
        if not isinstance(capability,Capability) or not callable(capability.execute):raise ValueError('registered executable capability required')
        if capability.id in self.registry:raise ValueError('duplicate capability ID')
        self.registry[capability.id]=capability
    def inventory(self):
        return [{'id':c.id,'input_type':c.input_type,'output_type':c.output_type,'effect':c.effect,'styles':c.styles,'version':c.version} for c in self.registry.values()]
    def select(self,requirements):
        matches=[c for c in self.registry.values() if c.input_type==requirements['input_type'] and c.output_type==requirements['output_type'] and c.effect==requirements['effect'] and requirements['style'] in c.styles]
        if not matches:raise ValueError('no capability satisfies required properties')
        if len(matches)>1:raise ValueError('ambiguous capabilities; explicit provider policy required')
        return matches[0]
    def specification(self,request,title):
        if not isinstance(request,str) or len(request)>100:raise ValueError('bounded graph request required')
        request=' '.join(request.lower().split())
        if request in ('graph','plot','chart'):return None
        styles={'graph these values':'line','plot these values':'line','line graph':'line','line chart':'line','bar chart':'bar','bar graph':'bar'}
        if request not in styles:raise ValueError('supported graph requests: graph these values, line graph, bar chart')
        if not isinstance(title,str) or len(title)>100:raise ValueError('bounded chart title required')
        return {'input_type':'numeric_series','output_type':'svg','effect':'plot_values','style':styles[request],
            'title':title,'x_axis':'index','y_axis':'value','preserve_order':True,'maximum_points':256}
    def series(self,values):
        if not isinstance(values,list) or not 1<=len(values)<=256:raise ValueError('1..256 numeric values required')
        if any(type(v) not in (int,float) or not math.isfinite(v) or abs(v)>1e12 for v in values):raise ValueError('finite numeric values within ±1e12 required')
        # Explicit adapter schema, not guessed opaque-byte meaning.
        numbers=[float(v) for v in values]
        raw=b'BNS1'+struct.pack('<H',len(numbers))+struct.pack('<'+'d'*len(numbers),*numbers)
        state=BinaryState((Record(1,BLOB,raw),))
        return numbers,state
    def verify_artists(self,style,artists,numbers):
        if style=='line':
            if list(artists.get_xdata())!=list(range(len(numbers))) or list(artists.get_ydata())!=numbers:raise ValueError('plotted coordinates differ from input')
        else:
            if len(artists)!=len(numbers):raise ValueError('bar count differs from input')
            for i,(bar,y) in enumerate(zip(artists,numbers)):
                if bar.get_height()!=y or not math.isclose(bar.get_x()+bar.get_width()/2,i,abs_tol=1e-12):raise ValueError('bar geometry differs from input')
    def plot(self,spec,numbers):
        import matplotlib
        from matplotlib.figure import Figure
        # No arbitrary Python code, tool strings, filenames or remote URLs.
        with matplotlib.rc_context({'svg.hashsalt':'bstae','text.usetex':False,'svg.fonttype':'none'}):
            fig=Figure(figsize=(6,4));ax=fig.subplots()
            try:
                xs=list(range(len(numbers)))
                artists=ax.plot(xs,numbers,marker='o',color='#138a72')[0] if spec['style']=='line' else ax.bar(xs,numbers,color='#138a72')
                ax.set_xlabel('Index');ax.set_ylabel('Value');ax.set_title(spec['title'],parse_math=False)
                ax.grid(axis='y',alpha=.25);fig.tight_layout()
                self.verify_artists(spec['style'],artists,numbers)
                stream=io.StringIO();fig.savefig(stream,format='svg',metadata={'Date':None,'Creator':'B-STAE Matplotlib adapter'})
                svg=stream.getvalue()
                if len(svg.encode())>500000:raise ValueError('chart exceeds SVG bound')
                root=ET.fromstring(svg)
                if root.tag!='{http://www.w3.org/2000/svg}svg' or not root.get('viewBox'):raise ValueError('invalid chart SVG')
                if any(node.tag.split('}')[-1]=='script' for node in root.iter()):raise ValueError('unexpected SVG script')
                return {'svg':svg,'coordinates':[{'x':i,'y':y} for i,y in enumerate(numbers)],
                    'verifier':'plot artist coordinates equal input series; SVG root and viewBox validated',
                    'provider_version':matplotlib.__version__}
            finally:fig.clear()
    def execute(self,request,values,title='B-STAE graph'):
        spec=self.specification(request,title)
        if spec is None:return {'status':'needs_details','reason':'Choose a line graph or bar chart.','choices':['line graph','bar chart']}
        numbers,entry=self.series(values);capability=self.select(spec)
        descriptor=json.dumps(spec,sort_keys=True,separators=(',',':')).encode()
        import matplotlib
        key=hashlib.sha256(entry.encode()+descriptor+capability.id.encode()+capability.version.encode()+matplotlib.__version__.encode()).hexdigest()
        previous=self.db.execute('SELECT * FROM capability_paths WHERE boundary=?',(key,)).fetchone()
        # Execute and verify on every reuse; memory never bypasses verification.
        result=capability.execute(spec,numbers);svg=result['svg'];output=BinaryState((Record(1,UTF8,svg.encode()),));digest=hashlib.sha256(output.encode()).hexdigest()
        reused=bool(previous and bytes(previous['entry'])==entry.encode() and bytes(previous['specification'])==descriptor and previous['capability']==capability.id and previous['output_hash']==digest)
        with self.db:self.db.execute('INSERT OR REPLACE INTO capability_paths VALUES (?,?,?,?,?,?)',
            (key,capability.id,descriptor,entry.encode(),digest,previous['uses']+1 if reused else 1))
        return dict(result,status='fulfilled',verified=True,capability=capability.id,requirements=spec,
            resolution='reverified_memory' if reused else 'property_selection',
            trace=[{'stage':'numeric_byte_adapter','schema':'BNS1: count uint16 LE, float64 LE values','entry_hex':entry.encode().hex()},
                {'stage':'capability_requirements','specification_hex':descriptor.hex()},
                {'stage':'provider_execution','output_hash':digest,'output_bytes':len(svg.encode())}],
            verification_scope='supplied numeric data faithfully plotted; data truth and arbitrary intent are not verified')
