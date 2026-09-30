"""B-STAE binary execution core. No language parser or model dependency."""
from dataclasses import dataclass
from collections import deque
import struct

INT64, UTF8, RGB, PCM16, POSITION3, BLOB = 1, 2, 3, 4, 5, 6
ADD, APPEND, COLOR_SHIFT, GAIN, TRANSLATE = 1, 2, 3, 4, 5
MAX_STATE = 1_000_000


def validate_payload(kind, payload):
    if type(payload) is not bytes: raise TypeError('payload must be immutable bytes')
    if kind == BLOB: return
    if kind == INT64 and len(payload) == 8: return
    if kind == RGB and len(payload) == 3: return
    if kind == POSITION3 and len(payload) == 12: return
    if kind == PCM16 and len(payload) % 2 == 0: return
    if kind == UTF8:
        payload.decode('utf-8', errors='strict'); return
    raise ValueError('invalid type or payload length')

@dataclass(frozen=True)
class Record:
    entity: int
    kind: int
    payload: bytes
    def __post_init__(self):
        if type(self.entity) is not int or not 0 <= self.entity < 2**32: raise ValueError('invalid entity ID')
        validate_payload(self.kind, self.payload)

@dataclass(frozen=True)
class BinaryState:
    records: tuple
    def __post_init__(self):
        if type(self.records) is not tuple or not all(isinstance(r, Record) for r in self.records): raise TypeError('tuple of records required')
        if len({r.entity for r in self.records}) != len(self.records): raise ValueError('duplicate entity')
        if len(self.records) > 65535: raise ValueError('too many records')
        if 7 + sum(9 + len(r.payload) for r in self.records) > MAX_STATE: raise ValueError('state exceeds byte limit')
    def encode(self):
        # Canonical little-endian wire format: magic, version, count, sorted TLVs.
        return b'BSTA' + struct.pack('<BH', 1, len(self.records)) + b''.join(
            struct.pack('<IBI', r.entity, r.kind, len(r.payload)) + r.payload
            for r in sorted(self.records, key=lambda x: x.entity))
    @classmethod
    def decode(cls, data):
        if type(data) is not bytes or len(data) < 7 or len(data) > MAX_STATE or data[:4] != b'BSTA': raise ValueError('invalid state bytes')
        version, count = struct.unpack_from('<BH', data, 4)
        if version != 1: raise ValueError('unsupported format version')
        offset, records = 7, []
        for _ in range(count):
            if offset + 9 > len(data): raise ValueError('truncated record header')
            entity, kind, size = struct.unpack_from('<IBI', data, offset); offset += 9
            if offset + size > len(data): raise ValueError('truncated payload')
            records.append(Record(entity, kind, data[offset:offset+size])); offset += size
        if offset != len(data): raise ValueError('trailing bytes')
        state = cls(tuple(records))
        if state.encode() != data: raise ValueError('noncanonical record order')
        return state
    def get(self, entity):
        return next((r for r in self.records if r.entity == entity), None)
    def replace(self, record):
        if self.get(record.entity) is None: raise ValueError('unknown entity')
        return BinaryState(tuple(record if r.entity == record.entity else r for r in self.records))

class ByteMemory:
    """Append-only byte-addressable arena; state descriptors remain separate."""
    def __init__(self): self._arena = bytearray(); self._spans = set()
    def store(self, state):
        data = state.encode(); span = (len(self._arena), len(data))
        self._arena.extend(data); self._spans.add(span); return span
    def load(self, span):
        if span not in self._spans: raise ValueError('unknown memory span')
        start, size = span
        return BinaryState.decode(bytes(self._arena[start:start+size]))
    def read_bytes(self, offset, count):
        if offset < 0 or count < 0 or offset + count > len(self._arena): raise ValueError('out of bounds')
        return bytes(self._arena[offset:offset+count])

@dataclass(frozen=True)
class Instruction:
    opcode: int
    entity: int
    parameters: bytes
    def encode(self): return struct.pack('<BII', self.opcode, self.entity, len(self.parameters)) + self.parameters
    @classmethod
    def decode(cls, data):
        if len(data) < 9: raise ValueError('truncated instruction')
        op, entity, size = struct.unpack_from('<BII', data)
        if len(data) != 9 + size: raise ValueError('invalid instruction length')
        item = cls(op, entity, data[9:]); validate_instruction(item); return item


def validate_instruction(item):
    if not isinstance(item, Instruction) or type(item.parameters) is not bytes: raise TypeError('binary instruction required')
    if type(item.entity) is not int or not 0 <= item.entity < 2**32: raise ValueError('invalid entity ID')
    expected = {ADD:8, COLOR_SHIFT:6, GAIN:8, TRANSLATE:12}
    if item.opcode == APPEND: item.parameters.decode('utf-8'); return
    if item.opcode not in expected or len(item.parameters) != expected[item.opcode]: raise ValueError('unknown opcode or invalid parameters')
    if item.opcode == GAIN and struct.unpack('<ii', item.parameters)[1] <= 0: raise ValueError('gain denominator must be positive')


def apply(state, item):
    validate_instruction(item)
    r = state.get(item.entity)
    required = {ADD:INT64, APPEND:UTF8, COLOR_SHIFT:RGB, GAIN:PCM16, TRANSLATE:POSITION3}[item.opcode]
    if r is None or r.kind != required: raise ValueError('operation/type mismatch')
    p = r.payload
    if item.opcode == ADD:
        p = struct.pack('<q', struct.unpack('<q',p)[0] + struct.unpack('<q',item.parameters)[0])
    elif item.opcode == APPEND: p += item.parameters
    elif item.opcode == COLOR_SHIFT:
        values = [a+b for a,b in zip(p, struct.unpack('<hhh',item.parameters))]
        if any(not 0 <= x <= 255 for x in values): raise ValueError('RGB overflow')
        p = bytes(values)
    elif item.opcode == GAIN:
        numerator, denominator = struct.unpack('<ii',item.parameters)
        output = []
        for (sample,) in struct.iter_unpack('<h',p):
            v = sample * numerator
            # Integer arithmetic with truncation toward zero, then saturation.
            v = (abs(v)//denominator) * (-1 if v < 0 else 1)
            output.append(struct.pack('<h',max(-32768,min(32767,v))))
        p = b''.join(output)
    elif item.opcode == TRANSLATE:
        p = struct.pack('<iii',*(a+b for a,b in zip(struct.unpack('<iii',p),struct.unpack('<iii',item.parameters))))
    return state.replace(Record(r.entity,r.kind,p))

@dataclass(frozen=True)
class BinaryResult:
    accepted: bool
    source: str
    reason: str
    program: tuple = ()
    snapshots: tuple = ()
    expansions: int = 0

class BinaryEngine:
    """Search operates on full binary states; byte endpoints are only index hints."""
    def __init__(self, instructions):
        encoded = []
        for item in instructions: validate_instruction(item); encoded.append(item.encode())
        self.instructions = tuple(sorted(set(encoded)))
        self.memory = {}
    @staticmethod
    def boundary_hint(data): return (data[:8],data[-8:],len(data))
    def execute(self, entry, target, program, allowed, max_depth):
        snapshots, current = [entry.encode()], entry
        if len(program) > max_depth: raise ValueError('depth exceeded')
        for raw in program:
            if raw not in self.instructions: raise ValueError('unregistered instruction')
            item = Instruction.decode(raw)
            if item.opcode not in allowed: raise ValueError('opcode denied')
            current = apply(current,item); snapshots.append(current.encode())
        if current.encode() != target.encode(): raise ValueError('target bytes not reached')
        return tuple(snapshots)
    def resolve(self, entry, target, max_depth=5, max_expansions=1000, allowed=frozenset({1,2,3,4,5}), max_frontier=10000):
        if any(type(v) is not int for v in (max_depth,max_expansions,max_frontier)) or max_depth < 0 or max_expansions < 1 or max_frontier < 1: raise ValueError('invalid search bounds')
        if not isinstance(allowed,frozenset): raise TypeError('immutable opcode permissions required')
        start, goal = entry.encode(),target.encode()
        # Full byte identity and operation set verify endpoint/length hints.
        key = (self.boundary_hint(start),self.boundary_hint(goal),start,goal,self.instructions,allowed,max_depth)
        if key in self.memory:
            program = self.memory[key]
            snapshots = self.execute(entry,target,program,allowed,max_depth)
            return BinaryResult(True,'memory','exact target bytes verified',program,snapshots)
        queue, seen, count = deque([(entry,())]), {start}, 0
        while queue and count < max_expansions:
            state, program = queue.popleft(); count += 1
            if state.encode() == goal:
                snapshots = self.execute(entry,target,program,allowed,max_depth)
                self.memory[key] = program
                return BinaryResult(True,'composition','exact target bytes verified',program,snapshots,count)
            if len(program) == max_depth: continue
            for raw in self.instructions:
                item = Instruction.decode(raw)
                if item.opcode not in allowed: continue
                try: next_state = apply(state,item)
                except (ValueError,OverflowError,struct.error): continue
                encoded = next_state.encode()
                if encoded in seen: continue
                if len(queue) >= max_frontier:
                    return BinaryResult(False,'composition','frontier budget exhausted',expansions=count)
                seen.add(encoded); queue.append((next_state, program+(raw,)))
        return BinaryResult(False,'composition','no target within registered operations and search bounds',expansions=count)


def decode_outputs(state):
    outputs = {}
    for r in state.records:
        if r.kind == INT64: value = struct.unpack('<q',r.payload)[0]
        elif r.kind == UTF8: value = r.payload.decode('utf-8')
        elif r.kind == RGB: value = {'rgb':list(r.payload),'hex':'#'+r.payload.hex()}
        elif r.kind == PCM16: value = [x[0] for x in struct.iter_unpack('<h',r.payload)]
        elif r.kind == POSITION3: value = list(struct.unpack('<iii',r.payload))
        else: value = {'bytes_hex':r.payload.hex()}
        outputs[r.entity] = value
    return outputs
