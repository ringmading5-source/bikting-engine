"""Run the standalone B-STAE chatbot: python chatbot/run.py."""
import argparse
import os
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent/'b-stae'))
from engine import Engine
from app import serve

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host',default=os.environ.get('BSTAE_HOST','127.0.0.1'))
    parser.add_argument('--port',type=int,default=int(os.environ.get('PORT','8765')))
    parser.add_argument('--db',default=os.environ.get('BSTAE_DB_PATH',str(ROOT/'data'/'chat.sqlite3')))
    args=parser.parse_args()
    Path(args.db).parent.mkdir(parents=True,exist_ok=True)
    engine=Engine(database=args.db)
    try:serve(engine,args.port,args.host,chat_home=True)
    finally:engine.close()

if __name__=='__main__':main()
