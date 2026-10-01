"""Grounded format adapters around the shared sequence relationship learner.

Image units are packed RGB pixels, audio units are PCM16 samples, and text units
are Unicode characters. Decoding formats is programmed, transformations learned.
This does not infer object identity, speech transcripts, or semantic meaning.
"""
from image_format import image_state


class MultimodalPatterns:
    def __init__(self,engine):self.engine=engine

    def encode(self,value):
        if isinstance(value,str):return list(value),{'modality':'text'},{}
        if isinstance(value,dict) and set(value)=={'image'}:
            width,height,raw=image_state(value['image'])
            units=[int.from_bytes(raw[i:i+3],'big') for i in range(0,len(raw),3)]
            return units,{'modality':'image','format':'rgb24'},{'width':width,'height':height}
        if isinstance(value,dict) and set(value)=={'audio'}:
            self.engine.recognize(value) # Existing validated format adapter.
            units=value['audio']['samples']
            if len(units)>4096:raise ValueError('experiment supports up to 4096 PCM16 samples')
            return units,{'modality':'audio','format':'pcm16','sample_rate':value['audio']['sample_rate']},{}
        raise ValueError('provide text, an image object, or a PCM16 audio object')

    @staticmethod
    def decode(units,format_context,metadata):
        modality=format_context['modality']
        if modality=='text':
            if any(not isinstance(x,str) or len(x)!=1 for x in units):raise ValueError('invalid character output')
            return ''.join(units)
        if modality=='image':
            if len(units)!=metadata['width']*metadata['height']:raise ValueError('output image dimensions cannot be inferred')
            if any(type(x) is not int or not 0<=x<=0xffffff for x in units):raise ValueError('invalid RGB pixel output')
            raw=b''.join(x.to_bytes(3,'big') for x in units)
            return {'image':dict(metadata,rgb_hex=raw.hex())}
        if any(type(x) is not int or not -32768<=x<=32767 for x in units):raise ValueError('invalid PCM16 output')
        return {'audio':{'samples':units,'sample_rate':format_context['sample_rate']}}

    def learn(self,before,after,context,source):
        units,fmt,meta=self.encode(before);output,other,outmeta=self.encode(after)
        if fmt!=other or meta!=outmeta:raise ValueError('paired examples require matching formats and image dimensions')
        scoped={'task':context,'format':fmt}
        example=self.engine.patterns.learn_pair(units,output,'multimodal:'+fmt['modality'],source,scoped)
        return {'example':example,'context':scoped,'level':'multimodal:'+fmt['modality']}

    def discover(self,value,context):
        units,fmt,meta=self.encode(value)
        return self.engine.discovery_patterns.discover('multimodal:'+fmt['modality'],{'task':context,'format':fmt})

    def predict(self,value,context):
        units,fmt,meta=self.encode(value)
        result=self.engine.pattern_runtime.select(units,'multimodal:'+fmt['modality'],{'task':context,'format':fmt})
        valid=[];rejected=[]
        for candidate in result['candidates']:
            try:output=self.decode(candidate['units'],fmt,meta)
            except ValueError as error:
                rejected.append({'units':candidate['units'],'reason':str(error)});continue
            valid.append(dict(candidate,output=output))
        preferred_units=[c['units'] for c in result['preferred']]
        preferred=[c for c in valid if c['units'] in preferred_units]
        return {'status':'predicted' if len(preferred)==1 else 'ambiguous' if preferred else 'unsupported_output' if rejected else 'unknown',
                'preferred':preferred,'candidates':valid,'rejected':rejected,'outcome_verified':False,
                'scope':'Learned signal transformations, not speech/object/semantic understanding.'}

    def request(self,text,value):
        routing=self.engine.request_patterns.route(text)
        if routing['status']!='routed':return {'status':routing['status'],'routing':routing}
        context=routing['preferred'][0]['context']
        return {'routing':routing,'prediction':self.predict(value,context),'context':context}
