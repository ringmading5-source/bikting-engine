import base64
import io
import math
import tempfile
import unittest
import wave
import struct
try:
    from PIL import Image
    import numpy
    MEDIA_AVAILABLE=True
except ImportError:
    MEDIA_AVAILABLE=False
from bstae import Model

def image(color,size=12):
    out=io.BytesIO();Image.new('RGB',(size,size),color).save(out,format='PNG')
    return {'kind':'image','data':base64.b64encode(out.getvalue()).decode()}

def audio(frequency,phase=0,amplitude=10000):
    out=io.BytesIO()
    with wave.open(out,'wb') as wav:
        wav.setparams((1,2,8000,0,'NONE','not compressed'))
        wav.writeframes(struct.pack('<'+'h'*1600,*[int(amplitude*math.sin(2*math.pi*frequency*i/8000+phase)) for i in range(1600)]))
    return {'kind':'audio','data':base64.b64encode(out.getvalue()).decode()}

@unittest.skipUnless(MEDIA_AVAILABLE, 'install media extras')
class MediaTests(unittest.TestCase):
    def test_unseen_inputs_and_checkpoint(self):
        with tempfile.TemporaryDirectory() as d:
            with Model() as model:
                for label,channel,freq in [('red',0,300),('blue',2,900)]:
                    for i,intensity in enumerate((210,230,250)):
                        color=[0,0,0];color[channel]=intensity
                        for value in (image(tuple(color)),audio(freq,i*.2),f'{label} '+['patch','tile','square'][i]):
                            model.request('media_observe',concept=label,value=value,source='synthetic',context='test')
                before=model.components.db.total_changes
                values=['red surface',image((235,0,0),15),audio(300,.9,8000)]
                result=model.request('media_inspect',values=values,context='test')
                self.assertEqual((result['status'],result['concept']),('aligned','red'))
                self.assertEqual(model.components.db.total_changes,before)
                self.assertEqual(model.request('media_predict',value=image((0,255,0)),context='test')['status'],'unknown')
                model.save(d+'/memory.sqlite')
            with Model.load(d+'/memory.sqlite') as model:
                self.assertEqual(model.request('media_predict',value=values[2],context='test')['concept'],'red')

    def test_validation_transcripts_and_conflicts(self):
        with Model() as model:
            for bad in ({'kind':'image','data':'!'},audio(0),{'kind':'video','data':'AAAA'},image((1,2,3))|{'transcript':'hi'}):
                with self.assertRaises(ValueError):model.request('media_predict',value=bad)
            v=audio(300)|{'transcript':'hello friend'}
            r=model.request('media_observe',value=v,concept='greeting',source='user')
            self.assertIn('transcript_example',r)
            model.request('media_observe',value=v,concept='other',source='user')
            self.assertEqual(model.request('media_predict',value=v)['status'],'contested')
            self.assertEqual(model.request('media_predict',value=v,context='elsewhere')['status'],'unknown')
