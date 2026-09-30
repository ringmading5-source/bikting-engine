import io
import tempfile
from pathlib import Path
import struct
import unittest
import wave
from recognition import recognize,recognize_bytes
from output import render
from core import Instruction,ADD,GAIN
from engine import Engine
from run import transform_and_render

class OutputTests(unittest.TestCase):
    def test_scalar_outputs(self):
        self.assertEqual(render(recognize(42)),(b'42\n','.json'))
        self.assertEqual(render(recognize('你好'))[0],'你好'.encode())
        self.assertEqual(render(recognize('#ff0000'))[0],b'#ff0000\n')
    def test_image_roundtrip(self):
        original=recognize_bytes(b'P6\n2 1\n255\n'+bytes([10,20,30,40,50,60]))
        raw,suffix=render(original)
        restored=recognize_bytes(raw)
        self.assertEqual(restored.state.encode(),original.state.encode())
        self.assertEqual(suffix,'.ppm')
    def wav(self):
        b=io.BytesIO()
        with wave.open(b,'wb') as w:
            w.setnchannels(1);w.setsampwidth(2);w.setframerate(8000);w.writeframes(struct.pack('<hh',10,-10))
        return b.getvalue()
    def test_audio_roundtrip(self):
        original=recognize_bytes(self.wav())
        restored=recognize_bytes(render(original)[0])
        self.assertEqual(restored.state,original.state)
        self.assertEqual(restored.metadata['sample_rate'],8000)
    def test_end_to_end_file(self):
        with tempfile.TemporaryDirectory() as d:
            e=Engine([Instruction(ADD,1,struct.pack('<q',2))],':memory:')
            p=Path(d)/'answer.json'
            result,path=transform_and_render(e,3,7,p,2)
            self.assertTrue(result.accepted);self.assertEqual(p.read_text(),'7\n');e.close()
    def test_failure_never_writes(self):
        with tempfile.TemporaryDirectory() as d:
            e=Engine([],':memory:');p=Path(d)/'answer.json'
            result,path=transform_and_render(e,3,7,p)
            self.assertFalse(result.accepted);self.assertFalse(p.exists());e.close()
    def test_wrong_extension_never_writes(self):
        with tempfile.TemporaryDirectory() as d:
            e=Engine([],':memory:');p=Path(d)/'answer.wav'
            with self.assertRaises(ValueError):transform_and_render(e,3,3,p)
            self.assertFalse(p.exists());e.close()
    def test_audio_transformation_saved(self):
        with tempfile.TemporaryDirectory() as d:
            start=Path(d)/'start.wav';goal=Path(d)/'goal.wav';out=Path(d)/'result.wav'
            start.write_bytes(self.wav())
            from recognition import Recognized
            from core import apply
            recognized=recognize(start);op=Instruction(GAIN,1,struct.pack('<ii',2,1))
            target=Recognized(apply(recognized.state,op),recognized.representation,recognized.metadata)
            goal.write_bytes(render(target)[0])
            e=Engine([op],':memory:');result,path=transform_and_render(e,start,goal,out,1)
            self.assertTrue(result.accepted);self.assertEqual(recognize(out).state,target.state);e.close()

if __name__=='__main__':unittest.main()
