"""Normal-value binary transformation with persistent verified transition memory."""
import argparse
import struct
from engine import Engine
from core import Instruction, ADD, BinaryState, decode_outputs

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--db',default='knowledge.sqlite3');args=p.parse_args()
    for run in range(2):
        e=Engine([Instruction(ADD,1,struct.pack('<q',2))],args.db)
        try:
            result=e.transform(3,7,max_depth=2)
            print('Run',run+1,result.source,'accepted:',result.accepted)
            print('Decoded states:',[decode_outputs(BinaryState.decode(s))[1] for s in result.snapshots])
            print(e.paths.stats())
        finally:e.close()
