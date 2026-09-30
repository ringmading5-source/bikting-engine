"""Ordinary input + source-backed request -> verified transformation."""
import argparse
import json
from pathlib import Path
from engine import Engine
from intent_bridge import IntentBridge
from run import ordinary
from output import render
from core import decode_outputs, BinaryState
from recognition import Recognized

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('input');p.add_argument('request');p.add_argument('--file',action='store_true')
    p.add_argument('--db',default='knowledge.sqlite3');p.add_argument('--depth',type=int,default=16);p.add_argument('--output')
    args=p.parse_args();engine=Engine(database=args.db)
    try:
        status,plan,result=IntentBridge(engine).fulfill(ordinary(args.input,args.file),args.request,args.depth)
        if result is not None and result.accepted:
            actual=Recognized(BinaryState.decode(result.snapshots[-1]),plan.target.representation,plan.target.metadata)
            status['decoded']=decode_outputs(actual.state)
            if args.output:
                data,extension=render(actual);path=Path(args.output)
                if path.suffix.lower()!=extension:raise ValueError('output requires '+extension)
                path.write_bytes(data);status['output']=str(path.resolve())
        print(json.dumps(status,ensure_ascii=False,indent=2))
        if status['status']!='verified':raise SystemExit(2)
    finally:engine.close()
