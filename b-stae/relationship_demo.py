"""Ordinary participants interact through persisted byte relationships."""
import argparse
import struct
from engine import Engine
from core import INT64,RGB,UTF8,BinaryState,decode_outputs
from byte_relationships import Guard,Fragment,Effect,Relationship

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--db',default='relationship-demo.sqlite3');args=p.parse_args()
    engine=Engine(database=args.db)
    try:
        rules=[Relationship(100,(Guard(1,INT64,signature=struct.pack('<q',1),mask=b'\xff'*8,length=8),Guard(2,RGB,length=3)),
                    (Effect(2,RGB,(Fragment(literal=b'\xff\x00\x00'),)),)),
               Relationship(101,(Guard(2,RGB,signature=b'\xff\x00\x00',mask=b'\xff'*3,length=3),Guard(3,UTF8)),
                    (Effect(3,UTF8,(Fragment(3),Fragment(literal=b'!'))),))]
        stored=engine.relationships.load()
        for rule in rules:
            if rule.id not in stored:engine.relationships.register(rule)
            elif rule.encode()!=stored[rule.id].encode():raise ValueError('demo rule ID has a different definition')
        inputs={1:1,2:'#000000',3:'Ready'};targets={1:1,2:'#ff0000',3:'Ready!'}
        result=engine.interact(inputs,targets,max_depth=2,allowed=frozenset({100,101}))
        print('Accepted:',result.accepted,'Resolution:',result.source,'Path:',result.program)
        for index,raw in enumerate(result.snapshots):
            state=BinaryState.decode(raw)
            print('State',index,'decoded:',decode_outputs(state))
            for record in state.records:print(' entity',record.entity,'type',record.kind,'bytes',record.payload.hex(' '))
        for rule in rules:print('Stored relationship',rule.id,'bytes:',rule.encode().hex(' '))
    finally:engine.close()
