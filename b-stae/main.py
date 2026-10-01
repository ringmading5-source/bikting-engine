"""Canonical CLI: ingest sources into binary memory or inspect encoded states."""
import argparse
import json
from engine import Engine
from core import decode_outputs

if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--db',default='knowledge.sqlite3')
    sub=p.add_subparsers(dest='command',required=True)
    sub.add_parser('file').add_argument('path')
    sub.add_parser('web').add_argument('url')
    sub.add_parser('show').add_argument('source_id',type=int)
    sub.add_parser('migrate')
    sub.add_parser('memory')
    sub.add_parser('session')
    sub.add_parser('import-relations').add_argument('source_id',type=int)
    rec=sub.add_parser('recognize');rec.add_argument('value');rec.add_argument('--file',action='store_true')
    args=p.parse_args()
    engine=Engine(database=args.db)
    try:
        if args.command=='session':
            from session import session
            session(engine)
            raise SystemExit(0)
        elif args.command=='import-relations':result={'imported':engine.relationship_sources.import_source(args.source_id)}
        elif args.command=='recognize':
            if args.file:
                from pathlib import Path
                value=Path(args.value)
            else:
                try:value=json.loads(args.value)
                except json.JSONDecodeError:value=args.value
            recognized=engine.recognize(value)
            result={'representation':recognized.representation,'metadata':recognized.metadata,
                'state_hex':recognized.state.encode().hex(),'decoded':decode_outputs(recognized.state)}
        elif args.command=='file': result={'source_id':engine.ingest_file(args.path)}
        elif args.command=='web': result={'source_id':engine.ingest_web(args.url)}
        elif args.command=='memory': result=engine.paths.stats()
        elif args.command=='migrate': result={'encoded_sources':engine.migrate_sources()}
        else:
            state=engine.source_state(args.source_id)
            result={'state_hex':state.encode().hex(),'decoded':decode_outputs(state),'verification_scope':'matches stored source bytes, not factual truth'}
        print(json.dumps(result,ensure_ascii=False,indent=2))
    finally:engine.close()
