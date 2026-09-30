"""B-STAE v0.1: bounded, deterministic transition memory. Python 3.10+."""
from dataclasses import dataclass
from collections import deque
from copy import deepcopy
import json

GATES = ('text', 'number', 'visual', 'audio', 'opcode', 'signal')

@dataclass(frozen=True)
class Signature:
    value: int
    relevance_mask: int = (1 << 64) - 1
    def __post_init__(self):
        for v in (self.value, self.relevance_mask):
            if type(v) is not int or not 0 <= v < 1 << 64:
                raise ValueError('signature fields must be unsigned 64-bit integers')
    def distance(self, other):
        return ((self.value ^ other.value) & self.relevance_mask & other.relevance_mask).bit_count()

class RepresentationDictionary:
    """Each gate byte is a local dictionary ID, never the original modality."""
    def __init__(self):
        self.entries = {g: [] for g in GATES}
    def encode(self, gate, descriptor):
        key = json.dumps(descriptor, sort_keys=True, separators=(',', ':'), allow_nan=False)
        entries = self.entries[gate]
        if key not in entries:
            if len(entries) == 256:
                raise OverflowError('gate dictionary exhausted; allocate another namespace')
            entries.append(key)
        return entries.index(key)
    def decode(self, gate, index):
        return json.loads(self.entries[gate][index])
    def pack(self, descriptors, control=0):
        if type(control) is not int or not 0 <= control < 1 << 16:
            raise ValueError('control must be unsigned 16-bit')
        if set(descriptors) != set(GATES):
            raise ValueError('all six gate descriptors required; use null for absent modalities')
        value = control << 48
        for offset, gate in enumerate(GATES):
            value |= self.encode(gate, descriptors[gate]) << (8 * offset)
        return Signature(value)

@dataclass(frozen=True)
class State:
    id: str
    signature: Signature
    verify: object  # pure predicate over observed execution context

@dataclass(frozen=True)
class Transition:
    id: str
    source: str
    target: str
    action: str  # ID into an explicit action registry
    required: frozenset = frozenset()
    inhibited: frozenset = frozenset()

@dataclass(frozen=True)
class Boundary:
    entry: str
    target: str
    max_depth: int
    constraints: frozenset = frozenset()
    max_expansions: int = 10000
    def __post_init__(self):
        if type(self.max_depth) is not int or self.max_depth < 0:
            raise ValueError('max_depth must be a nonnegative integer')
        if type(self.max_expansions) is not int or self.max_expansions < 1:
            raise ValueError('max_expansions must be positive')
        if not isinstance(self.constraints, frozenset):
            raise TypeError('constraints must be immutable')

@dataclass(frozen=True)
class Path:
    transitions: tuple

@dataclass(frozen=True)
class Verification:
    accepted: bool
    reason: str
    context: dict
    trace: tuple
    source: str

class Engine:
    """Actions here operate on isolated in-memory contexts, not external systems."""
    def __init__(self, knowledge=None):
        self.knowledge = knowledge
        self.states, self.transitions, self.actions = {}, {}, {}
        self.memory = {}
        self.reinforcements = {}
        self.revision = 0
    def retrieve_knowledge(self, query, limit=5):
        """Evidence retrieval does not register actions or promote paths."""
        if self.knowledge is None:
            return []
        return self.knowledge.search(query, limit)

    def _register(self, registry, key, value):
        if key in registry:
            raise ValueError('duplicate ID: ' + key)
        registry[key] = value
        self.revision += 1
    def register_state(self, state):
        self._register(self.states, state.id, state)
    def register_action(self, name, action):
        if not callable(action):
            raise TypeError('action must be callable')
        self._register(self.actions, name, action)
    def register_transition(self, edge):
        if edge.source not in self.states or edge.target not in self.states or edge.action not in self.actions:
            raise ValueError('unregistered state or action')
        self._register(self.transitions, edge.id, edge)
    def allowed(self, edge, boundary):
        return edge.required <= boundary.constraints and not edge.inhibited & boundary.constraints
    def key(self, boundary):
        # Full immutable key avoids treating a hash collision as boundary identity.
        return (self.revision, boundary)
    def candidates(self, boundary):
        queue = deque([(boundary.entry, ())])
        expanded = 0
        while queue and expanded < boundary.max_expansions:
            state, path = queue.popleft()
            expanded += 1
            if state == boundary.target:
                yield Path(path)
                continue
            if len(path) >= boundary.max_depth:
                continue
            visited = {boundary.entry} | {self.transitions[x].target for x in path}
            for edge in sorted(self.transitions.values(), key=lambda e: e.id):
                if edge.source == state and edge.target not in visited and self.allowed(edge, boundary):
                    queue.append((edge.target, path + (edge.id,)))
    def execute(self, boundary, path, context, source):
        work, trace, current = deepcopy(context), [], boundary.entry
        try:
            if not self.states[current].verify(work):
                raise ValueError('entry verification failed')
            if len(path.transitions) > boundary.max_depth:
                raise ValueError('depth exceeded')
            for edge_id in path.transitions:
                edge = self.transitions[edge_id]
                if edge.source != current or not self.allowed(edge, boundary):
                    raise ValueError('invalid transition or constraints')
                self.actions[edge.action](work)
                if not self.states[edge.target].verify(work):
                    raise ValueError('state verification failed: ' + edge.target)
                current = edge.target
                trace.append(edge.id)
            if current != boundary.target or not self.states[boundary.target].verify(work):
                raise ValueError('target verification failed')
            return Verification(True, 'verified target', work, tuple(trace), source)
        except Exception as error:
            return Verification(False, str(error), deepcopy(context), tuple(trace), source)
    def resolve(self, boundary, context):
        if boundary.entry not in self.states or boundary.target not in self.states:
            raise ValueError('unknown boundary state')
        key = self.key(boundary)
        cached = self.memory.get(key)
        if cached is not None:
            result = self.execute(boundary, cached, context, 'memory')
            if result.accepted:
                self.reinforcements[key] += 1
                return result
            del self.memory[key]
            self.reinforcements.pop(key, None)
        last = Verification(False, 'no verified path within search bounds', deepcopy(context), (), 'composition')
        for path in self.candidates(boundary):
            last = self.execute(boundary, path, context, 'composition')
            if last.accepted:
                self.memory[key] = path
                self.reinforcements[key] = 1
                return last
        return last
