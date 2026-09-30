"""Versioned persistent binary transition programs; complete boundary identity."""
import hashlib
import json
import struct

OPERATION_VERSION = 1
MAX_PROGRAM_BYTES = 5_000_000


def boundary_key(entry, target, instructions, allowed, max_depth):
    # SHA hashes are integrity checks only; complete bytes are retained as identity.
    return json.dumps({'format':1,'operations_version':OPERATION_VERSION,
        'entry':entry.encode().hex(),'target':target.encode().hex(),
        'instructions':[raw.hex() for raw in instructions],
        'allowed':sorted(allowed),'depth':max_depth},sort_keys=True,separators=(',',':')).encode()


def encode_program(program):
    raw=b'BPRG'+struct.pack('<BI',1,len(program))+b''.join(struct.pack('<I',len(x))+x for x in program)
    if len(raw)>MAX_PROGRAM_BYTES:raise ValueError('program exceeds storage limit')
    return raw


def decode_program(raw,max_depth):
    if len(raw)<9 or len(raw)>MAX_PROGRAM_BYTES or raw[:4]!=b'BPRG':raise ValueError('invalid program')
    version,count=struct.unpack_from('<BI',raw,4)
    if version!=1 or count>max_depth:raise ValueError('unsupported program version or depth')
    offset,program=9,[]
    for _ in range(count):
        if offset+4>len(raw):raise ValueError('truncated program')
        size=struct.unpack_from('<I',raw,offset)[0];offset+=4
        if size<9 or offset+size>len(raw):raise ValueError('invalid instruction span')
        program.append(raw[offset:offset+size]);offset+=size
    if offset!=len(raw):raise ValueError('trailing program bytes')
    return tuple(program)

class PathMemory:
    def __init__(self,db):
        self.db=db
        self.db.execute('''CREATE TABLE IF NOT EXISTS binary_paths (
            boundary BLOB PRIMARY KEY, program BLOB NOT NULL,
            sha256 TEXT NOT NULL, successes INTEGER NOT NULL DEFAULT 0)''')
    def get(self,key,max_depth):
        row=self.db.execute('SELECT program,sha256 FROM binary_paths WHERE boundary=?',(key,)).fetchone()
        if row is None:return None
        raw=bytes(row[0])
        if hashlib.sha256(raw).hexdigest()!=row[1]:raise ValueError('program integrity mismatch')
        return decode_program(raw,max_depth)
    def put(self,key,program):
        raw=encode_program(program)
        with self.db:
            self.db.execute('''INSERT INTO binary_paths VALUES (?,?,?,1)
                ON CONFLICT(boundary) DO UPDATE SET program=excluded.program,
                sha256=excluded.sha256,successes=binary_paths.successes+1''',
                (key,raw,hashlib.sha256(raw).hexdigest()))
    def reinforce(self,key):
        with self.db:self.db.execute('UPDATE binary_paths SET successes=successes+1 WHERE boundary=?',(key,))
    def reject(self,key):
        with self.db:self.db.execute('DELETE FROM binary_paths WHERE boundary=?',(key,))
    def stats(self):
        row=self.db.execute('SELECT COUNT(*),COALESCE(SUM(successes),0) FROM binary_paths').fetchone()
        return {'verified_paths':row[0],'successful_executions':row[1],'operation_version':OPERATION_VERSION}
