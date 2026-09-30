"""Main B-STAE engine: source adapters feed persistent typed binary memory."""
import hashlib
from path_memory import PathMemory, boundary_key
from core import BinaryResult
from core import BinaryEngine, BinaryState, ByteMemory, Record, UTF8, INT64, decode_outputs
from knowledge import KnowledgeMemory
import struct

class Engine(BinaryEngine):
    def __init__(self, instructions=(), database='knowledge.sqlite3'):
        super().__init__(instructions)
        self.knowledge = KnowledgeMemory(database)
        self.bytes = ByteMemory()
        self.db = self.knowledge.db
        self.db.execute('''CREATE TABLE IF NOT EXISTS binary_sources (
            source_id INTEGER PRIMARY KEY, state BLOB NOT NULL, state_sha256 TEXT NOT NULL)''')
        self.paths = PathMemory(self.db)
        from byte_relationships import RelationshipEngine
        self.relationships = RelationshipEngine(self.db)
        from bound_relationships import BoundResolver
        self.bound_relationships = BoundResolver(self.relationships)
        from relationship_sources import RelationshipSources
        self.relationship_sources = RelationshipSources(self)
        from learning import Learner
        self.learner = Learner(self)
        from sequences import SequenceExtractor
        self.sequences = SequenceExtractor(self)
        from image_memory import ImageMemory
        self.images = ImageMemory(self)
        from modality_memory import ModalityMemory
        self.modalities = ModalityMemory(self)
        from intent_engine import IntentEngine
        self.intents = IntentEngine(self)
        from recursive_sequences import RecursiveSequences
        self.recursion = RecursiveSequences(self)
        from word_sequences import WordSequences
        self.words = WordSequences(self)
        from concept_grounding import ConceptGrounding
        self.concepts = ConceptGrounding(self)
        from relationship_extraction import RelationshipExtraction
        self.extraction = RelationshipExtraction(self)
        from capabilities import CapabilityRegistry
        self.capabilities = CapabilityRegistry(self)
        from series_pipeline import SeriesPipeline
        self.series_plans = SeriesPipeline(self)
        self.words.register('plot ordered values',intent={'operation':'plot_values','style':'line'})
        self.words.register('graph these values',children=['plot ordered values'])
        self.words.register('line graph',children=['plot ordered values'])
        self.words.register('plot ordered bars',intent={'operation':'plot_values','style':'bar'})
        self.words.register('bar chart',children=['plot ordered bars'])
    def resolve(self, entry, target, max_depth=5, max_expansions=1000,
                allowed=frozenset({1,2,3,4,5}), max_frontier=10000):
        if any(type(v) is not int for v in (max_depth,max_expansions,max_frontier)) or max_depth < 0 or max_expansions < 1 or max_frontier < 1:
            raise ValueError('invalid search bounds')
        if not isinstance(allowed,frozenset) or any(type(v) is not int or not 1 <= v <= 5 for v in allowed):
            raise ValueError('immutable registered opcode permissions required')
        key=boundary_key(entry,target,self.instructions,allowed,max_depth)
        try:
            program=self.paths.get(key,max_depth)
            if program is not None:
                snapshots=self.execute(entry,target,program,allowed,max_depth)
                self.paths.reinforce(key)
                return BinaryResult(True,'persistent_memory','exact target bytes reverified',program,snapshots)
        except (ValueError,OverflowError,struct.error):
            self.paths.reject(key)
        result=super().resolve(entry,target,max_depth,max_expansions,allowed,max_frontier)
        if result.accepted:self.paths.put(key,result.program)
        return result
    def interact(self, inputs, targets, **constraints):
        # Entity IDs identify participants; each ordinary value is recognized automatically.
        def state(values):
            records=[]
            for entity,value in sorted(values.items()):
                recognized=self.recognize(value,entity)
                records.extend(recognized.state.records)
            return BinaryState(tuple(records))
        return self.bound_relationships.resolve(state(inputs),state(targets),**constraints)
    def resolve_relationships(self, entry, target, **constraints):
        return self.relationships.resolve(entry, target, **constraints)
    def fulfill_request(self, value, request, **constraints):
        from intent_bridge import IntentBridge
        return IntentBridge(self).fulfill(value, request, **constraints)
    def recognize(self, value, entity=1):
        from recognition import recognize
        return recognize(value, entity)
    def transform(self, value, target_value, **bounds):
        entry = self.recognize(value)
        target = self.recognize(target_value)
        if entry.representation != target.representation:
            raise ValueError('representation conversion requires a registered conversion operation')
        for field in ('sample_rate', 'channels', 'width', 'height'):
            if entry.metadata.get(field) != target.metadata.get(field):
                raise ValueError('format metadata conversion not implemented: ' + field)
        return self.resolve(entry.state, target.state, **bounds)
    def close(self): self.knowledge.close()
    def _source_state(self, row):
        # The fields have fixed schema IDs; source_id is a numeric payload.
        return BinaryState((Record(1,UTF8,row['text'].encode('utf-8')),
            Record(2,UTF8,row['source'].encode('utf-8')),
            Record(3,UTF8,row['sha256'].encode('ascii')),
            Record(4,INT64,struct.pack('<q',row['id'])),
            Record(5,UTF8,row['title'].encode('utf-8'))))
    def encode_source(self, source_id):
        row=self.db.execute('SELECT * FROM sources WHERE id=?',(source_id,)).fetchone()
        if row is None: raise ValueError('unknown source')
        state=self._source_state(row); raw=state.encode()
        with self.db:
            self.db.execute('INSERT OR REPLACE INTO binary_sources VALUES (?,?,?)',
                (source_id,raw,hashlib.sha256(raw).hexdigest()))
        return self.bytes.store(state)
    def ingest_file(self, path):
        sid=self.knowledge.ingest_file(path)
        self.encode_source(sid); return sid
    def ingest_web(self, url, scraper=None):
        sid=self.knowledge.ingest_web(url,scraper)
        self.encode_source(sid); return sid
    def source_state(self, source_id):
        row=self.db.execute('SELECT * FROM binary_sources WHERE source_id=?',(source_id,)).fetchone()
        if row is None:
            self.encode_source(source_id)
            row=self.db.execute('SELECT * FROM binary_sources WHERE source_id=?',(source_id,)).fetchone()
        raw=bytes(row['state'])
        if hashlib.sha256(raw).hexdigest()!=row['state_sha256']: raise ValueError('corrupt binary source')
        source=self.db.execute('SELECT * FROM sources WHERE id=?',(source_id,)).fetchone()
        if source is None or self._source_state(source).encode()!=raw: raise ValueError('source provenance mismatch')
        return BinaryState.decode(raw)
    def retrieve_knowledge(self, query, limit=5):
        # Keyword search is an adapter; all returned sources include binary records.
        hits=self.knowledge.search(query,limit)
        return [dict(hit,binary_state=self.source_state(hit['id']).encode()) for hit in hits]
    def transform_source(self, source_id, target, **bounds):
        # Returns a derived state; does not overwrite the cited original source.
        return self.resolve(self.source_state(source_id),target,**bounds)
    def migrate_sources(self):
        ids=[r[0] for r in self.db.execute('SELECT id FROM sources ORDER BY id')]
        for sid in ids: self.encode_source(sid)
        return len(ids)
