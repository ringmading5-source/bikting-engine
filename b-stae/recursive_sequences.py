"""Typed byte-sequence relationships recursively resolve to grounded operations."""
import json
from core import BinaryState,decode_outputs

class ResolutionStop(Exception):
    def __init__(self,status,reason):self.status=status;self.reason=reason

class RecursiveSequences:
    def __init__(self,engine):
        self.engine=engine;self.db=engine.db
        self.db.execute('''CREATE TABLE IF NOT EXISTS sequence_relations (
            id INTEGER PRIMARY KEY, context TEXT NOT NULL, payload BLOB NOT NULL,
            length INTEGER NOT NULL, first INTEGER NOT NULL, last INTEGER NOT NULL,
            definition TEXT NOT NULL, UNIQUE(context,payload,definition))''')
        self.db.execute('CREATE INDEX IF NOT EXISTS sequence_endpoints ON sequence_relations(context,length,first,last)')
    def key(self,value):
        recognized,context=self.engine.modalities.recognize(value)
        raw=recognized.state.get(1).payload
        if not raw:raise ValueError('nonempty sequence required')
        return {'context':context,'hex':raw.hex()}
    def register(self,value,children=None,intent=None):
        if (children is None)==(intent is None):raise ValueError('provide children or a grounded intent')
        key=self.key(value);raw=bytes.fromhex(key['hex'])
        if children is not None:
            if not isinstance(children,list) or not 1<=len(children)<=16:raise ValueError('1..16 child sequences required')
            definition={'children':[self.key(child) for child in children]}
        else:definition={'intent':self.engine.intents.parse(intent)}
        encoded=json.dumps(definition,sort_keys=True,separators=(',',':'))
        with self.db:self.db.execute('INSERT OR IGNORE INTO sequence_relations(context,payload,length,first,last,definition) VALUES (?,?,?,?,?,?)',
            (key['context'],raw,len(raw),raw[0],raw[-1],encoded))
        return {'status':'registered','index':{'length':len(raw),'first':raw[0],'last':raw[-1]},'definition':definition}
    def resolve(self,value,max_depth=8,max_nodes=256,max_actions=32):
        if any(type(x)is not int for x in (max_depth,max_nodes,max_actions)) or not 1<=max_depth<=32 or not 1<=max_nodes<=2048 or not 1<=max_actions<=64:raise ValueError('invalid recursive bounds')
        root=self.key(value);trace=[];nodes=0
        def expand(key,depth,active):
            nonlocal nodes
            nodes+=1
            if nodes>max_nodes or depth>max_depth:raise ResolutionStop('bounded','recursive resolution budget reached')
            identity=(key['context'],key['hex'])
            if identity in active:raise ResolutionStop('cycle','sequence relationship cycle detected')
            raw=bytes.fromhex(key['hex']);active=active|{identity}
            rows=self.db.execute('SELECT payload,definition FROM sequence_relations WHERE context=? AND length=? AND first=? AND last=? ORDER BY id LIMIT 65',
                (key['context'],len(raw),raw[0],raw[-1])).fetchall()
            if len(rows)>64:raise ResolutionStop('bounded','endpoint candidate budget reached')
            exact=[json.loads(row['definition']) for row in rows if bytes(row['payload'])==raw]
            trace.append({'depth':depth,'length':len(raw),'first':raw[0],'last':raw[-1],
                'sequence_hex':raw.hex(),'endpoint_candidates':len(rows),'full_matches':len(exact)})
            # Conflicting exact relations are never chosen by insertion order.
            if len(exact)>1:raise ResolutionStop('ambiguous','multiple full-sequence relationships')
            if exact:
                definition=exact[0]
                if 'intent' in definition:return [definition['intent']]
                actions=[]
                for child in definition['children']:
                    actions.extend(expand(child,depth+1,active))
                    if len(actions)>max_actions:raise ResolutionStop('bounded','action budget reached')
                return actions
            # Ordered subsequence decomposition: inspect only registered spans that
            # match their full bytes. No nearest-neighbor or endpoint-only acceptance.
            lengths=[r[0] for r in self.db.execute('SELECT DISTINCT length FROM sequence_relations WHERE context=? AND length<? ORDER BY length DESC LIMIT 257',(key['context'],len(raw)))]
            if len(lengths)>256:raise ResolutionStop('bounded','subsequence length budget reached')
            memo={len(raw):[[]]}
            def partitions(offset,count=0):
                nonlocal nodes
                nodes+=1
                if count>max_actions:raise ResolutionStop('bounded','partition span budget reached')
                if nodes>max_nodes:raise ResolutionStop('bounded','partition budget reached')
                if offset in memo:return memo[offset]
                paths=[]
                for length in lengths:
                    end=offset+length
                    if end>len(raw):continue
                    span=raw[offset:end]
                    matches=self.db.execute('SELECT payload FROM sequence_relations WHERE context=? AND length=? AND first=? AND last=? LIMIT 65',(key['context'],length,span[0],span[-1])).fetchall()
                    if len(matches)>64:raise ResolutionStop('bounded','subsequence candidate budget reached')
                    if not any(bytes(r[0])==span for r in matches):continue
                    for tail in partitions(end,count+1):
                        paths.append([{'context':key['context'],'hex':span.hex()}]+tail)
                        if len(paths)>1:break
                    if len(paths)>1:break
                memo[offset]=paths;return paths
            paths=partitions(0)
            if not paths:raise ResolutionStop('unknown','no grounded full sequence or ordered decomposition')
            if len(paths)>1:raise ResolutionStop('ambiguous','multiple ordered subsequence decompositions')
            actions=[]
            for child in paths[0]:
                actions.extend(expand(child,depth+1,active))
                if len(actions)>max_actions:raise ResolutionStop('bounded','action budget reached')
            return actions
        try:
            actions=expand(root,0,set())
            return {'status':'resolved','actions':actions,'trace':trace,'nodes':nodes}
        except ResolutionStop as error:return {'status':error.status,'reason':error.reason,'trace':trace,'nodes':nodes}
    def execute(self,sequence,value,**bounds):
        resolution=self.resolve(sequence,**bounds)
        if resolution['status']!='resolved':return resolution
        recognized,context=self.engine.modalities.recognize(value);state=recognized.state
        # Preflight the entire plan before executing or reinforcing any paths.
        states=[state]
        for intent in resolution['actions']:
            state,_=self.engine.intents.boundary(state,intent);states.append(state)
        results=[];current=value
        for index,intent in enumerate(resolution['actions']):
            result=self.engine.intents.execute(current,intent)
            if result['boundary']['target_hex']!=states[index+1].encode().hex():raise ValueError('recursive target verification failed')
            results.append(result)
            decoded=result['decoded']
            rep=recognized.representation
            if rep=='pcm16':current={'audio':{'samples':decoded,'sample_rate':recognized.metadata['sample_rate']}}
            elif rep=='position3':current={'position':decoded}
            elif rep=='rgb24':current=decoded['hex']
            else:current=decoded
        return dict(resolution,status='fulfilled',verified=True,decoded=decode_outputs(states[-1])[1],
            entry_hex=states[0].encode().hex(),target_hex=states[-1].encode().hex(),execution=results)
