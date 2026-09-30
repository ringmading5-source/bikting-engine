import io
import tempfile
from pathlib import Path
import struct
import unittest
import wave
from recognition import *
from engine import Engine
from core import Instruction, ADD, COLOR_SHIFT, decode_outputs

class RecognitionTests(unittest.TestCase):
    def test_normal_values(self):
        self.assertEqual(decode_outputs(recognize(42).state)[1],42)
        self.assertEqual(recognize('你好').representation,'utf8')
        self.assertEqual(recognize('#ff0080').state.get(1).payload,b'\xff\x00\x80')
        self.assertEqual(recognize('42').representation,'utf8')
    def test_no_arbitrary_guessing(self):
        for value in (b'hello',(255,0,0),True,1.5):
            with self.assertRaises(ValueError):recognize(value)
    def test_text_file_and_binary_signature(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'notes.txt';p.write_text('hello')
            self.assertEqual(recognize(p).state.get(1).payload,b'hello')
            p.write_bytes(b'\x89PNG\r\n')
            with self.assertRaisesRegex(ValueError,'decoder'):recognize(p)
    def test_wav(self):
        b=io.BytesIO()
        with wave.open(b,'wb') as w:
            w.setnchannels(1);w.setsampwidth(2);w.setframerate(16000);w.writeframes(struct.pack('<hh',100,-100))
        result=recognize(b.getvalue())
        self.assertEqual(result.metadata['sample_rate'],16000)
        self.assertEqual(decode_outputs(result.state)[1],[100,-100])
        with self.assertRaises((ValueError,EOFError,wave.Error)):recognize(b.getvalue()[:-1])
    def test_pixels(self):
        r=recognize(b'P6\n2 1\n255\n'+bytes([10,20,30,255,0,128]))
        self.assertEqual(len(r.state.records),2)
        self.assertEqual(r.metadata['width'],2)
        self.assertEqual(r.state.get(1).payload,bytes([10,20,30]))
        with self.assertRaises(ValueError):recognize(b'P6\n2 1\n255\n'+b'123')
    def test_ordinary_inputs_execute(self):
        e=Engine([Instruction(ADD,1,struct.pack('<q',2))],':memory:')
        self.assertTrue(e.transform(3,7,max_depth=2).accepted)
        self.assertEqual(e.transform(3,7,max_depth=2).source,'persistent_memory');e.close()
        e=Engine([Instruction(COLOR_SHIFT,1,struct.pack('<hhh',10,0,0))],':memory:')
        self.assertTrue(e.transform('#000000','#0a0000',max_depth=1).accepted);e.close()
    def test_bsta(self):
        state=recognize(12).state
        self.assertEqual(recognize(state.encode()).state,state)

if __name__=='__main__':unittest.main()
