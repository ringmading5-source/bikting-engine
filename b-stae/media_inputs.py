"""Bounded local media decoding and supervised similarity learning; no ASR."""
import base64
import binascii
import io
import math
import wave
from shared_concepts import SharedConcepts, normalized

class MediaInputs(SharedConcepts):
    encoder_version='media-features-v1'
    scope='Labeled similarity learning: spatial RGB and acoustic spectra; not object recognition or speech transcription.'

    def decode(self,value):
        if isinstance(value,str):return value,None
        if not isinstance(value,dict) or not {'kind','data'}<=set(value) or set(value)-{'kind','data','transcript'}:
            raise ValueError('text or kind/data[/transcript] object required')
        if value['kind'] not in ('image','audio'):raise ValueError('image or audio kind required')
        data=value['data']
        if not isinstance(data,str) or len(data)>940000:raise ValueError('base64 file up to 700 KB required')
        try:raw=base64.b64decode(data,validate=True)
        except (ValueError,binascii.Error):raise ValueError('invalid base64 file') from None
        if not raw or len(raw)>700000:raise ValueError('file must contain 1..700000 bytes')
        transcript=value.get('transcript')
        if transcript is not None:
            if value['kind']!='audio' or not isinstance(transcript,str) or not transcript.strip() or len(transcript)>512:
                raise ValueError('audio transcript must contain 1..512 characters')
        if value['kind']=='image':
            try:
                from PIL import Image,ImageOps
            except ImportError:raise ValueError('install bikting-bstae[media] for image inputs') from None
            try:
                with Image.open(io.BytesIO(raw)) as image:
                    if image.format not in ('PNG','JPEG') or image.width*image.height>4000000:
                        raise ValueError('PNG/JPEG image up to 4 million pixels required')
                    image=ImageOps.exif_transpose(image).convert('RGB').resize((8,8))
                    return {'pixels':list(image.tobytes())},None
            except (OSError,Image.DecompressionBombError):raise ValueError('invalid image file') from None
        try:
            with wave.open(io.BytesIO(raw),'rb') as audio:
                channels,rate,count=audio.getnchannels(),audio.getframerate(),audio.getnframes()
                if audio.getsampwidth()!=2 or channels not in (1,2) or not 4000<=rate<=48000 or not 32<=count<=rate*10:
                    raise ValueError('32 samples to 10 seconds of mono/stereo PCM16 WAV at 4..48 kHz required')
                pcm=audio.readframes(count)
                if len(pcm)!=count*channels*2:raise ValueError('truncated WAV file')
        except (wave.Error,EOFError):raise ValueError('invalid PCM16 WAV file') from None
        import struct
        samples=struct.unpack('<'+'h'*(len(pcm)//2),pcm)
        mono=[sum(samples[i:i+channels])/channels/32768 for i in range(0,len(samples),channels)]
        if max(abs(x) for x in mono)<0.0001:raise ValueError('non-silent audio required')
        return {'samples':mono,'rate':rate},transcript

    def encode(self,value):
        decoded,_=self.decode(value)
        if isinstance(decoded,str):return super().encode(decoded)
        if 'pixels' in decoded:
            return 'image',[x/255 for x in decoded['pixels']]
        try:import numpy as np
        except ImportError:raise ValueError('install bikting-bstae[media] for audio inputs') from None
        samples=np.asarray(decoded['samples']);rate=decoded['rate']
        size=min(512,len(samples));starts=np.linspace(0,len(samples)-size,min(32,max(1,len(samples)//size)),dtype=int)
        spectra=[];crossings=[]
        edges=np.geomspace(80,min(rate/2,8000),25)
        frequencies=np.fft.rfftfreq(size,1/rate)
        for start in starts:
            frame=samples[start:start+size];frame=frame-frame.mean()
            power=abs(np.fft.rfft(frame*np.hanning(size)))**2
            spectra.append([float(power[(frequencies>=a)&(frequencies<b)].sum()) for a,b in zip(edges,edges[1:])])
            crossings.append(float(np.mean(frame[1:]*frame[:-1]<0)))
        spectrum=np.mean(spectra,axis=0)
        return 'audio',normalized(np.sqrt(spectrum).tolist())+[float(np.mean(crossings))]

    def observe(self,concept,value,source,context=None):
        # Validate all aligned evidence before inserting either modality.
        _,transcript=self.decode(value)
        self.encode(value)
        if transcript is not None:super().encode(transcript)
        with self.db:
            result=super().observe(concept,value,source,context)
            if transcript is not None:
                result['transcript_example']=super().observe(concept,transcript,source,context)['example']
        result['scope']=self.scope
        return result

    def predict(self,value,context=None):
        _,transcript=self.decode(value)
        result=super().predict(value,context)
        if transcript is not None:
            result['supplied_transcript_prediction']=super().predict(transcript,context)
        result['scope']=self.scope
        return result
