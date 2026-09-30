import struct
import unittest
from core import *

class BinaryTests(unittest.TestCase):
    def state(self,n): return BinaryState((Record(1,INT64,struct.pack('<q',n)),))
    def test_wire_and_byte_memory(self):
        s=self.state(7); m=ByteMemory(); address=m.store(s)
        self.assertEqual(m.load(address),s)
        self.assertEqual(m.read_bytes(*address),s.encode())
        self.assertEqual(BinaryState.decode(s.encode()),s)
    def test_corruption(self):
        for data in (b'',self.state(1).encode()[:-1],self.state(1).encode()+b'x'):
            with self.assertRaises(ValueError): BinaryState.decode(data)
        with self.assertRaises(ValueError): BinaryState((Record(1,RGB,b'12'),))
    def test_calculation_and_memory(self):
        add=Instruction(ADD,1,struct.pack('<q',2)); e=BinaryEngine([add])
        first=e.resolve(self.state(1),self.state(5),2)
        self.assertTrue(first.accepted); self.assertEqual(len(first.program),2)
        self.assertEqual(e.resolve(self.state(1),self.state(5),2).source,'memory')
        self.assertEqual([decode_outputs(BinaryState.decode(x))[1] for x in first.snapshots],[1,3,5])
    def test_types_permissions_overflow(self):
        add=Instruction(ADD,1,struct.pack('<q',1)); e=BinaryEngine([add])
        self.assertFalse(e.resolve(self.state(0),self.state(1),allowed=frozenset()).accepted)
        with self.assertRaises(ValueError): apply(BinaryState((Record(1,RGB,b'123'),)),add)
        with self.assertRaises(struct.error): apply(self.state(2**63-1),add)
    def test_color(self):
        s=BinaryState((Record(2,RGB,bytes([10,20,30])),))
        t=apply(s,Instruction(COLOR_SHIFT,2,struct.pack('<hhh',5,-5,10)))
        self.assertEqual(decode_outputs(t)[2]['rgb'],[15,15,40])
    def test_audio(self):
        s=BinaryState((Record(3,PCM16,struct.pack('<hhh',-3,5,20000)),))
        t=apply(s,Instruction(GAIN,3,struct.pack('<ii',2,1)))
        self.assertEqual(decode_outputs(t)[3],[-6,10,32767])
        with self.assertRaises(ValueError): BinaryEngine([Instruction(GAIN,3,struct.pack('<ii',1,0))])
    def test_text_and_position(self):
        s=BinaryState((Record(4,UTF8,'你'.encode()),Record(5,POSITION3,struct.pack('<iii',1,2,3))))
        s=apply(s,Instruction(APPEND,4,'好'.encode()))
        s=apply(s,Instruction(TRANSLATE,5,struct.pack('<iii',1,-1,2)))
        self.assertEqual(decode_outputs(s)[4],'你好');self.assertEqual(decode_outputs(s)[5],[2,1,5])
    def test_bounds(self):
        e=BinaryEngine([Instruction(ADD,1,struct.pack('<q',1))])
        self.assertFalse(e.resolve(self.state(0),self.state(3),2).accepted)
        self.assertFalse(e.resolve(self.state(0),self.state(3),3,max_expansions=1).accepted)
        self.assertFalse(e.memory)
    def test_hint_collision_not_identity(self):
        a=BinaryState((Record(1,UTF8,b'abcdefgh11111111abcdefgh'),))
        b=BinaryState((Record(1,UTF8,b'abcdefgh22222222abcdefgh'),))
        self.assertEqual(BinaryEngine.boundary_hint(a.encode()),BinaryEngine.boundary_hint(b.encode()))
        self.assertFalse(BinaryEngine([]).resolve(a,b).accepted)
    def test_instruction_wire(self):
        item=Instruction(ADD,1,struct.pack('<q',4))
        self.assertEqual(Instruction.decode(item.encode()),item)
        with self.assertRaises(ValueError):Instruction.decode(item.encode()[:-1])

if __name__=='__main__':unittest.main()
