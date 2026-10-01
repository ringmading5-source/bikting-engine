"""Bounded request -> relationship plan -> execution -> independent goal check.

Reuses exact verified request/context plans; new combinations use registered
relationships. Neither this module nor its tests claim universal generalization.
"""
import base64
import hashlib
import json
import re
import struct
from core import decode_outputs
from representation import canonical
from recognition import recognize, recognize_bytes

class TaskRuntime:
    def __init__(self, engine, gemini):
        self.engine, self.db, self.gemini = engine, engine.db, gemini
        from behavior_library import BehaviorLibrary
        self.behaviors=BehaviorLibrary(engine)
        self.db.execute('CREATE TABLE IF NOT EXISTS verified_task_plans (id TEXT PRIMARY KEY, actions TEXT NOT NULL, uses INTEGER NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS workspace_artifacts (id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, content BLOB NOT NULL)')

    def input(self, value):
        if isinstance(value,dict) and set(value)=={'format','base64'}:
            if value['format'] not in ('wav','ppm','utf8') or not isinstance(value['base64'],str) or len(value['base64'])>300000: raise ValueError('bounded wav, ppm or utf8 input required')
            raw=base64.b64decode(value['base64'],validate=True)
            if value['format']=='utf8': return raw.decode('utf-8')
            result=recognize_bytes(raw)
            if value['format']=='wav' and result.representation=='pcm16':
                return {'audio':{'samples':decode_outputs(result.state)[1],'sample_rate':result.metadata['sample_rate']}}
            if value['format']=='ppm' and result.representation=='ppm-rgb24':
                return {'width':result.metadata['width'],'height':result.metadata['height'],'rgb_hex':b''.join(r.payload for r in result.state.records).hex()}
            raise ValueError('declared input format differs from bytes')
        from behavior_library import typed
        typed(value)
        return value

    def key(self,text,value):
        # Definitions and adapter version invalidate prior plans when context changes.
        definitions=[tuple(r) for r in self.db.execute('SELECT id,definition FROM word_relations ORDER BY id')]
        return hashlib.sha256(canonical({'version':2,'library':self.behaviors.fingerprint(),'text':text,'value':value,'definitions':definitions})).hexdigest()

    def plan(self,text,value,max_actions=16,use_gemini=False):
        if not isinstance(text,str) or not 1<=len(text)<=2000 or type(max_actions)is not int or not 1<=max_actions<=32 or type(use_gemini)is not bool:
            raise ValueError('bounded text, action limit and boolean use_gemini required')
        key=self.key(text,value)
        row=self.db.execute('SELECT actions FROM verified_task_plans WHERE id=?',(key,)).fetchone()
        if row:
            actions=json.loads(row[0])
            if not 1<=len(actions)<=max_actions: raise ValueError('cached plan exceeds current budget')
            return {'status':'planned','actions':actions,'source':'verified_memory','model_calls':0,'key':key}
        actions=[];trace=[]
        # Conjunction is explicit; quoted strings are parsed as one operation first.
        try: actions=[self.behaviors.parse(text)]
        except ValueError:
            resolution=({'status':'unknown'} if isinstance(value,list) else self.engine.words.resolve(text,value,max_actions=max_actions,persist=False))
            trace=resolution.get('trace',[])
            if resolution.get('reason')=='ungrounded fixed point': return dict(resolution,status='cycle')
            if resolution['status']=='stabilized': actions=resolution['actions']
            elif resolution['status'] in ('cycle','ambiguous','bounded','incoherent'): return resolution
            else:
                clauses=re.split(r'\s+then\s+',text,flags=re.I)
                if len(clauses)>max_actions: raise ValueError('action budget exceeded')
                for clause in clauses:
                    match=re.fullmatch(r'\s*(?:please\s+)?(?:increase|raise)(?:\s+(?:it|the number|this number))?\s+by\s+([+-]?\d+)\s*',clause,re.I)
                    try:
                        intent={'operation':'add','amount':int(match[1])} if match else self.behaviors.parse(clause)
                    except ValueError:
                        result=({'status':'unknown'} if isinstance(value,list) else self.engine.words.resolve(clause,value,max_actions=max_actions,persist=False))
                        if result['status']=='stabilized': actions.extend(result['actions']);continue
                        if result['status']!='unknown':return result
                        if not use_gemini or len(clauses)!=1:return {'status':'needs_clarification','reason':'Register the unresolved phrase or use a supported explicit operation.','model_calls':0}
                        proposal=self.gemini.interpret(text,value)
                        if proposal['status']!='proposed': return proposal
                        return {'status':'planned','actions':[proposal['intent']],'source':proposal['source'],'model_calls':proposal['model_calls'],'key':key}
                    actions.append(intent)
        if not 1<=len(actions)<=max_actions:raise ValueError('action budget exceeded')
        return {'status':'planned','actions':actions,'source':'relationships_and_grammar','trace':trace,'model_calls':0,'key':key}

    def execute(self,text,value,goal,output_code='101',max_actions=16,use_gemini=False):
        if not isinstance(goal,dict) or set(goal)!={'equals'}:raise ValueError('independent goal {equals: expected_value} required')
        if not isinstance(output_code,str) or len(output_code)!=3 or any(x not in '01' for x in output_code):raise ValueError('three-bit output routing required')
        value=self.input(value)
        plan=self.plan(text,value,max_actions,use_gemini)
        if plan['status']!='planned':return plan
        decoded=value;preflight=[]
        for action in plan['actions']:
            decoded,check=self.behaviors.apply(decoded,action)
            preflight.append(check)
        if canonical(decoded)!=canonical(goal['equals']):return {'status':'goal_mismatch','expected':goal['equals'],'proposed':decoded,'verified':False,'model_calls':plan['model_calls']}
        observed=value;execution=[]
        for index,action in enumerate(plan['actions']):
            observed,check=self.behaviors.apply(observed,action)
            if check!=preflight[index]:raise ValueError('execution differs from preflight state')
            execution.append(dict(check,action=action))
        if canonical(observed)!=canonical(goal['equals']):raise ValueError('observed task goal mismatch')
        narration='Verified result: '+json.dumps(decoded,ensure_ascii=False)
        outputs=[];code=int(output_code,2)
        if code&1:outputs.append({'modality':'text','value':narration,'start_ms':0,'duration_ms':4000})
        if code&2:outputs.append({'modality':'voice','text':narration,'adapter':'browser_speech_synthesis','start_ms':0,'duration_ms':4000})
        if code&4:outputs.append({'modality':'visual','value':decoded,'adapter':'structured_result','start_ms':0,'duration_ms':4000})
        with self.db:self.db.execute('INSERT INTO verified_task_plans VALUES (?,?,1) ON CONFLICT(id) DO UPDATE SET uses=uses+1',(plan['key'],json.dumps(plan['actions'],sort_keys=True)))
        return {'status':'fulfilled','verified':True,'result':decoded,'plan':plan,'goal':goal,'outputs':outputs,'execution':execution,'verification_scope':'supplied exact goal and executed state; grammar/relationships are bounded, model interpretation is not proven'}

    def artifact(self,name,content,mime='text/plain'):
        if not isinstance(name,str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,100}',name) or mime not in ('text/plain','application/json','image/svg+xml') or not isinstance(content,str) or len(content.encode())>200000:
            raise ValueError('bounded filename, supported MIME and text content required')
        raw=content.encode('utf-8')
        if mime=='application/json':json.loads(content)
        ident=hashlib.sha256(canonical([name,mime])+raw).hexdigest()
        with self.db:self.db.execute('INSERT OR IGNORE INTO workspace_artifacts VALUES (?,?,?,?)',(ident,name,mime,raw))
        row=self.db.execute('SELECT content FROM workspace_artifacts WHERE id=?',(ident,)).fetchone()
        if bytes(row[0])!=raw:raise ValueError('artifact readback failed')
        return {'artifact_id':ident,'name':name,'mime':mime,'base64':base64.b64encode(raw).decode(),'verified':True,'verification_scope':'saved bytes re-read from workspace store'}
