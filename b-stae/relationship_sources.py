"""Import explicit source relationships with observed before/after fixtures."""
import hashlib
import json
import struct
from byte_relationships import Relationship
from core import BinaryState

class RelationshipSources:
    def __init__(self,engine):
        self.engine=engine;self.db=engine.db
        self.db.execute('CREATE TABLE IF NOT EXISTS relationship_provenance (relationship_id INTEGER PRIMARY KEY,source_id INTEGER NOT NULL,source_hash TEXT NOT NULL,fixture_count INTEGER NOT NULL)')
    def import_source(self,source_id):
        row=self.db.execute('SELECT * FROM sources WHERE id=?',(source_id,)).fetchone()
        if row is None or row['mime']!='application/json':raise ValueError('JSON relationship source required')
        payload=json.loads(self.engine.source_state(source_id).get(1).payload.decode())
        entries=payload.get('byte_relationships') if isinstance(payload,dict) else None
        if not isinstance(entries,list) or not entries or len(entries)>100:raise ValueError('1..100 byte_relationships entries required')
        validated=[]
        for item in entries:
            if set(item)!={'definition','observations'}:raise ValueError('definition and observations required')
            body=json.dumps(item['definition'],sort_keys=True,separators=(',',':')).encode()
            rule=Relationship.decode(b'BRLT'+struct.pack('<BI',1,len(body))+body)
            observations=item['observations']
            if not isinstance(observations,list) or not 1<=len(observations)<=100:raise ValueError('bounded observations required')
            for observation in observations:
                if set(observation)!={'before','after'}:raise ValueError('before/after observation required')
                before=BinaryState.decode(bytes.fromhex(observation['before']))
                after=BinaryState.decode(bytes.fromhex(observation['after']))
                if rule.apply(before).encode()!=after.encode():raise ValueError('relationship does not reproduce observation')
            validated.append((rule,len(observations)))
        if len({r.id for r,_ in validated})!=len(validated):raise ValueError('duplicate imported IDs')
        # One transaction for the complete import, preserving existing rule identity.
        with self.db:
            for rule,count in validated:
                raw=rule.encode()
                existing=self.db.execute('SELECT rule FROM byte_relationships WHERE id=?',(rule.id,)).fetchone()
                provenance=self.db.execute('SELECT source_hash FROM relationship_provenance WHERE relationship_id=?',(rule.id,)).fetchone()
                if existing:
                    if bytes(existing[0])==raw and provenance and provenance[0]==row['sha256']:continue
                    raise ValueError('relationship ID already has a different rule or source')
                self.db.execute('INSERT INTO byte_relationships VALUES (?,?,?)',(rule.id,raw,hashlib.sha256(raw).hexdigest()))
                self.db.execute('INSERT INTO relationship_provenance VALUES (?,?,?,?)',(rule.id,source_id,row['sha256'],count))
        return [rule.id for rule,_ in validated]
    def provenance(self):
        return [dict(r) for r in self.db.execute('SELECT p.*,s.source FROM relationship_provenance p JOIN sources s ON p.source_id=s.id ORDER BY relationship_id')]
