import unittest
import base64
import io
import wave
import tempfile
from pathlib import Path
from engine import Engine
from app import Application

def dataset(pairs):return {'training':[{'before':a,'after':b} for a,b in pairs[:2]],'validation':[{'before':pairs[2][0],'after':pairs[2][1]}]}
def audio(samples,rate=8000):return {'audio':{'samples':samples,'sample_rate':rate}}
class ModalityTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:')
    def tearDown(self):self.e.close()
    def test_all_supported_modalities(self):
        cases=[([('Hi','Hi!'),('Hello','Hello!'),('Hey','Hey!')],'New','New!'),
          ([(3,5),(7,9),(11,13)],100,102),
          ([('#102030','#302010'),('#405060','#605040'),('#708090','#908070')],'#aabbcc',{'rgb':[204,187,170],'hex':'#ccbbaa'}),
          ([({'position':[x,0,0]},{'position':[x+2,0,0]}) for x in (0,4,20)],{'position':[100,0,0]},[102,0,0]),
          ([(audio([x,x+10]),audio([x+1,x+11])) for x in (10,30,50)],audio([100,200]),[101,201])]
        for pairs,value,expected in cases:
            with self.subTest(value=value):
                learned=self.e.modalities.observe(dataset(pairs));result=self.e.modalities.transform(value,learned['model'])
                self.assertEqual(result['decoded'],expected)
                self.assertTrue(self.e.modalities.observe(dataset(pairs))['cached'])
                if 'wav_base64' in result:
                    with wave.open(io.BytesIO(base64.b64decode(result['wav_base64'])),'rb') as wav:
                        self.assertEqual(wav.getframerate(),8000);self.assertEqual(wav.getnframes(),2)
    def test_context_rejection(self):
        model=self.e.modalities.observe(dataset([(audio([x,x+10]),audio([x+1,x+11])) for x in (10,30,50)]))['model']
        with self.assertRaises(ValueError):self.e.modalities.transform(audio([100,200],16000),model)
        with self.assertRaises(ValueError):self.e.modalities.transform('hello',model)
    def test_validation_and_overlap(self):
        for pairs in [[(3,5),(7,9),(11,14)],[(3,5),(7,9),(3,5)]]:
            with self.assertRaises(ValueError):self.e.modalities.observe(dataset(pairs))
        self.assertEqual(self.e.modalities.models(),[])
    def test_overflow(self):
        model=self.e.modalities.observe(dataset([(3,5),(7,9),(11,13)]))['model']
        with self.assertRaises((ValueError,OverflowError)):self.e.modalities.transform(2**63-1,model)
    def test_app_and_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            path=str(Path(folder)/'memory.sqlite3');e=Engine(database=path);app=Application(e)
            learned=app.dispatch({'action':'modality_observe','observations':dataset([(3,5),(7,9),(11,13)])});e.close();e=Engine(database=path);app=Application(e)
            self.assertEqual(len(app.dispatch({'action':'modality_models'})['models']),1)
            self.assertEqual(app.dispatch({'action':'modality_transform','value':100,'model':learned['model']})['decoded'],102)
            e.db.execute("UPDATE modality_programs SET program_hash='bad'")
            with self.assertRaises(ValueError):e.modalities.transform(100,learned['model'])
            e.close()
    def test_mixed_and_bound(self):
        with self.assertRaises(ValueError):self.e.modalities.observe(dataset([(3,5),(7,9),('x','x!')]))
        with self.assertRaises(ValueError):self.e.modalities.recognize('a'*16385)
