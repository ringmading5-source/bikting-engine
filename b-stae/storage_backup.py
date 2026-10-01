"""Consistent SQLite checkpoint for copying to durable storage by an operator.
Usage: python storage_backup.py SOURCE DESTINATION
Does not expose backups through the public API or overwrite existing files.
"""
import sqlite3
from pathlib import Path

def backup(source,destination):
    source,destination=Path(source).resolve(),Path(destination).resolve()
    if not source.is_file() or source==destination:raise ValueError('existing distinct source required')
    destination.parent.mkdir(parents=True,exist_ok=True)
    with destination.open('xb'):pass
    try:
        with sqlite3.connect(source.as_uri()+'?mode=ro',uri=True) as incoming, sqlite3.connect(destination) as outgoing:
            incoming.backup(outgoing)
            if outgoing.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('backup integrity failed')
    except Exception:
        destination.unlink(missing_ok=True);raise
    return str(destination)

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('source');parser.add_argument('destination');args=parser.parse_args()
    print(backup(args.source,args.destination))
