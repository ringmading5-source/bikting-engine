"""Ordered word-byte relationships reach a grounded executable fixed point."""
import hashlib
import json
import re

class WordSequences:
    def __init__(self,engine):
        self.engine=engine;self.db=engine.db
        self.db.execute('''CREATE TABLE IF NOT EXISTS word_relations (
            id INTEGER PRIMARY KEY, count INTEGER NOT NULL, first BLOB NOT NULL, last BLOB NOT NULL,
            sequence BLOB NOT NULL, definition TEXT NOT NULL, UNIQUE(sequence,definition))''')
        self.db.execute('CREATE INDEX IF NOT EXISTS word_endpoints ON word_relations(count,first,last)')
        self.db.execute('''CREATE TABLE IF NOT EXISTS stable_word_intents (
            fingerprint TEXT PRIMARY KEY, sequence BLOB NOT NULL, entry BLOB NOT NULL, report TEXT NOT NULL)''')
    def tokens(self,text):
        if not isinstance(text,str) or len(text.encode())>4096:raise ValueError('word sequence must be bounded text')
        words=[m.group().encode('utf-8') for m in re.finditer(r'\S+',text)]
        if not 1<=len(words)<=64:raise ValueError('1..64 whitespace-delimited words required')
        return words
    def pack(self,words):return json.dumps([w.hex() for w in words],separators=(',',':')).encode()
    def register(self,text,children=None,intent=None):
        words=self.tokens(text)
        if (children is None)==(intent is None):raise ValueError('provide child sequences or a grounded intent')
        if children is not None:
            if not isinstance(children,list) or not 1<=len(children)<=16:raise ValueError('1..16 child sequences required')
            definition={'children':[[w.hex() for w in self.tokens(child)] for child in children]}
        else:definition={'intent':self.engine.intents.parse(intent)}
        with self.db:self.db.execute('INSERT OR IGNORE INTO word_relations(count,first,last,sequence,definition) VALUES (?,?,?,?,?)',
            (len(words),words[0],words[-1],self.pack(words),json.dumps(definition,sort_keys=True)))
        return {'status':'registered','word_count':len(words),'first_hex':words[0].hex(),'last_hex':words[-1].hex()}
    def resolve(self,text,value,max_rounds=16,max_nodes=256,max_actions=32):
        if any(type(x)is not int for x in (max_rounds,max_nodes,max_actions)) or not 1<=max_rounds<=32 or not 1<=max_nodes<=2048 or not 1<=max_actions<=64:raise ValueError('invalid stabilization bounds')
        words=self.tokens(text);pending=[{'words':[w.hex() for w in words]}];history=set();trace=[];nodes=0
        def lookup(tokens):
            nonlocal nodes
            nodes+=1
            if nodes>max_nodes:raise Stop('bounded','word candidate budget reached')
            rows=self.db.execute('SELECT sequence,definition FROM word_relations WHERE count=? AND first=? AND last=? ORDER BY id LIMIT 65',(len(tokens),tokens[0],tokens[-1])).fetchall()
            if len(rows)>64:raise Stop('bounded','word endpoint candidate budget reached')
            packed=self.pack(tokens);matches=[json.loads(r['definition']) for r in rows if bytes(r['sequence'])==packed]
            if len(matches)>1:raise Stop('ambiguous','conflicting full word-sequence relationships')
            return matches
        class Stop(Exception):
            def __init__(self,status,reason):self.status=status;self.reason=reason
        def decompose(tokens):
            # Dynamic programming over word boundaries, never within a word's bytes.
            covers={len(tokens):[[]]}
            for offset in range(len(tokens)-1,-1,-1):
                paths=[]
                for end in range(len(tokens),offset,-1):
                    if offset==0 and end==len(tokens):continue
                    if not covers.get(end):continue
                    matches=lookup(tokens[offset:end])
                    if not matches:continue
                    for tail in covers[end]:
                        paths.append([{'words':[w.hex() for w in tokens[offset:end]]}]+tail)
                        if len(paths)>1:break
                    if len(paths)>1:break
                covers[offset]=paths
            paths=covers.get(0,[])
            if not paths:raise Stop('unknown','unresolved word relationships remain')
            if len(paths)>1:raise Stop('ambiguous','multiple ordered word decompositions')
            return paths[0]
        try:
            for round_id in range(max_rounds):
                canonical=json.dumps(pending,sort_keys=True,separators=(',',':'))
                if canonical in history:raise Stop('cycle','word sequence refinement repeats without grounding')
                history.add(canonical);following=[]
                for item in pending:
                    if 'intent' in item:following.append(item);continue
                    tokens=[bytes.fromhex(w) for w in item['words']];matches=lookup(tokens)
                    if matches:
                        definition=matches[0]
                        if 'intent' in definition:following.append({'intent':definition['intent']})
                        else:following.extend({'words':child} for child in definition['children'])
                    else:following.extend(decompose(tokens))
                    if len(following)>max_actions:raise Stop('bounded','word action/sequence budget reached')
                trace.append({'round':round_id,'before':pending,'after':following})
                if following==pending:
                    if any('words' in item for item in following):raise Stop('unknown','ungrounded fixed point')
                    actions=[item['intent'] for item in following]
                    recognized,context=self.engine.modalities.recognize(value);state=recognized.state;targets=[]
                    try:
                        for action in actions:
                            state,_=self.engine.intents.boundary(state,action);targets.append(state.encode().hex())
                    except (ValueError,OverflowError) as error:raise Stop('incoherent',str(error))
                    report={'status':'stabilized','actions':actions,'trace':trace,'rounds':round_id+1,'nodes':nodes,
                        'words':[{'text':w.decode(),'hex':w.hex()} for w in words],
                        'index':{'word_count':len(words),'first_hex':words[0].hex(),'last_hex':words[-1].hex()},
                        'coherence':{'all_terminals_grounded':True,'ordered_targets_valid':True,'target_hex':state.encode().hex(),'targets':targets},
                        'scope':'fixed point of supplied relationships and valid typed transitions; not proof of human intent'}
                    # Include all definitions so a changed relationship changes memory identity.
                    definitions=[tuple(row) for row in self.db.execute('SELECT id,definition FROM word_relations ORDER BY id')]
                    key=hashlib.sha256(self.pack(words)+recognized.state.encode()+context.encode()+json.dumps(definitions).encode()).hexdigest()
                    with self.db:self.db.execute('INSERT OR REPLACE INTO stable_word_intents VALUES (?,?,?,?)',(key,self.pack(words),recognized.state.encode(),json.dumps(report)))
                    return report
                pending=following
            raise Stop('bounded','stabilization round budget reached')
        except Stop as error:return {'status':error.status,'reason':error.reason,'trace':trace,'nodes':nodes}
    def execute(self,text,value,**bounds):
        result=self.resolve(text,value,**bounds)
        if result['status']!='stabilized':return result
        executed=self.engine.recursion.execute_actions(result,value)
        if executed['target_hex']!=result['coherence']['target_hex']:raise ValueError('stabilized intent target mismatch')
        return dict(executed,stabilized=True)
