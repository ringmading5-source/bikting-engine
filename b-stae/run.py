"""Recognize normal inputs, solve a binary boundary, render a verified output."""
import argparse
import json
from pathlib import Path
import struct
from core import Instruction,ADD,APPEND,COLOR_SHIFT,GAIN,BinaryState
from engine import Engine
from recognition import Recognized
from output import render


def ordinary(text,is_file=False):
    if is_file:return Path(text)
    try:return json.loads(text)
    except json.JSONDecodeError:return text


def transform_and_render(engine,value,target,output_path,max_depth=5):
    entry=engine.recognize(value);goal=engine.recognize(target)
    result=engine.transform(value,target,max_depth=max_depth)
    if not result.accepted:return result,None
    final=BinaryState.decode(result.snapshots[-1])
    artifact=Recognized(final,goal.representation,goal.metadata)
    data,suffix=render(artifact)
    path=Path(output_path)
    if path.suffix.lower()!=suffix:raise ValueError('output requires extension '+suffix)
    # Build and validate all output bytes before writing.
    path.write_bytes(data)
    return result,str(path.resolve())

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('input');p.add_argument('target');p.add_argument('--input-file',action='store_true');p.add_argument('--target-file',action='store_true')
    p.add_argument('--output',required=True);p.add_argument('--db',default='knowledge.sqlite3');p.add_argument('--depth',type=int,default=5)
    ops=p.add_mutually_exclusive_group(required=True)
    ops.add_argument('--add',type=int);ops.add_argument('--append');ops.add_argument('--shift',type=int,nargs=3);ops.add_argument('--gain',type=int,nargs=2,metavar=('NUMERATOR','DENOMINATOR'))
    args=p.parse_args()
    value,target=ordinary(args.input,args.input_file),ordinary(args.target,args.target_file)
    e=Engine(database=args.db)
    try:
        recognized=e.recognize(value)
        if args.add is not None:opcode,params=ADD,struct.pack('<q',args.add)
        elif args.append is not None:opcode,params=APPEND,args.append.encode('utf-8')
        elif args.shift is not None:opcode,params=COLOR_SHIFT,struct.pack('<hhh',*args.shift)
        else:opcode,params=GAIN,struct.pack('<ii',*args.gain)
        # Entity addresses come from recognized records, never from user byte input.
        instructions=[Instruction(opcode,r.entity,params) for r in recognized.state.records]
    finally:e.close()
    e=Engine(instructions,args.db)
    try:
        result,path=transform_and_render(e,value,target,args.output,args.depth)
        print(json.dumps({'accepted':result.accepted,'resolution':result.source,'reason':result.reason,
                          'transitions':len(result.program),'output':path},indent=2))
        if not result.accepted:raise SystemExit(2)
    finally:e.close()
