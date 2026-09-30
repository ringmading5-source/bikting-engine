"""Local B-STAE interface. Run python app.py and open the printed loopback URL."""
import argparse
from http.server import BaseHTTPRequestHandler,HTTPServer
import json
from pathlib import Path
import secrets
import os
from urllib.parse import urlsplit
from engine import Engine
from knowledge import parse_source
from core import BinaryState,decode_outputs

class Application:
    def __init__(self,engine):
        self.engine=engine;self.pending={}
        from web_knowledge import WebKnowledge
        self.web=WebKnowledge(engine)
        self.engine.db.execute('''CREATE TABLE IF NOT EXISTS outcome_feedback (
            id INTEGER PRIMARY KEY,decision TEXT NOT NULL,input_state BLOB NOT NULL,
            output_state BLOB NOT NULL,relationships TEXT NOT NULL)''')
    def dispatch(self,payload):
        if not isinstance(payload,dict):raise ValueError('request object required')
        action=payload.get('action')
        if action=='word_register':
            return self.engine.words.register(payload.get('text'),children=payload.get('children'),intent=payload.get('intent'))
        if action=='word_resolve':
            return self.engine.words.resolve(payload.get('text'),payload.get('value'))
        if action=='word_execute':
            return self.engine.words.execute(payload.get('text'),payload.get('value'))
        if action=='word_demo':
            self.engine.words.register('increase',intent={'operation':'add','amount':2})
            self.engine.words.register('increase twice',children=['increase','increase'])
            self.engine.words.register('increase four times',children=['increase twice','increase twice'])
            return self.engine.words.execute('increase four times',payload.get('value',100))
        if action=='recursive_register':
            return self.engine.recursion.register(payload.get('sequence'),children=payload.get('children'),intent=payload.get('intent'))
        if action=='recursive_resolve':
            return self.engine.recursion.resolve(payload.get('sequence'))
        if action=='recursive_execute':
            return self.engine.recursion.execute(payload.get('sequence'),payload.get('value'))
        if action=='recursive_demo':
            self.engine.recursion.register('step-two',intent={'operation':'add','amount':2})
            self.engine.recursion.register('increase-four',children=['step-two','step-two'])
            self.engine.recursion.register('increase-eight',children=['increase-four','increase-four'])
            return self.engine.recursion.execute('increase-eight',payload.get('value',100))
        if action=='intent_execute':
            return self.engine.intents.execute(payload.get('value'),payload.get('intent'),payload.get('max_depth',3))
        if action=='image_intent':
            return self.engine.intents.image(payload.get('image'),payload.get('intent'))
        if action=='modality_observe':
            return self.engine.modalities.observe(payload.get('observations'))
        if action=='modality_transform':
            return self.engine.modalities.transform(payload.get('value'),payload.get('model'))
        if action=='modality_models':
            return {'models':self.engine.modalities.models()}
        if action=='image_observe':
            return self.engine.images.observe(payload.get('observations'))
        if action=='image_transform':
            return self.engine.images.transform(payload.get('image'),payload.get('model'))
        if action=='sequence_example':
            row=self.engine.db.execute('SELECT report FROM behavior_models WHERE relationship_id=600').fetchone()
            if row:return json.loads(row[0])
            sid=self.engine.ingest_file(Path(__file__).parent/'examples'/'position-sequences.json')
            return self.engine.sequences.learn_source(sid,600)
        if action=='sequence_learn':
            data=payload.get('sequences')
            if not isinstance(data,dict):raise ValueError('sequence source object required')
            sid=self.engine.knowledge.ingest(parse_source(json.dumps(data),'application/json','local-sequences:'+secrets.token_hex(8)))
            self.engine.encode_source(sid)
            return self.engine.sequences.learn_source(sid,payload['relationship_id'])
        if action=='behavior_predict':
            from session import participants
            return self.engine.sequences.predict(participants(payload['inputs']),payload.get('event'))
        if action=='research':
            try:return self.web.research(payload.get('query'),payload.get('url'))
            except Exception as error:return {'status':'web_error','reason':str(error),'sources':[]}
        if action=='learn':
            training=payload.get('training');validation=payload.get('validation')
            data={'training':training,'validation':validation}
            sid=self.engine.knowledge.ingest(parse_source(json.dumps(data,ensure_ascii=False),'application/json','local-observations:'+secrets.token_hex(8)))
            self.engine.encode_source(sid)
            return self.engine.learner.learn_source(sid,payload['relationship_id'])
        if action=='examples':
            results=[]
            for name,rid in [('observations.json',200),('color-observations.json',201)]:
                if rid in self.engine.relationships.load():
                    results.append({'relationship_id':rid,'status':'already_registered'});continue
                sid=self.engine.ingest_file(Path(__file__).parent/'examples'/name)
                results.append(self.engine.learner.learn_source(sid,rid))
            return {'status':'loaded','results':results}
        if action=='predict':
            from session import participants
            inputs=participants(payload['inputs'])
            status,result=self.engine.learner.predict(inputs)
            if result is not None and result.accepted:
                token=secrets.token_hex(16)
                self.pending[token]=(result.snapshots[0],result.snapshots[-1],status['evidence'])
                if len(self.pending)>100:self.pending.pop(next(iter(self.pending)))
                status.update(token=token,trace=[{'decoded':decode_outputs(BinaryState.decode(raw)),
                    'records':[{'entity':r.entity,'type':r.kind,'payload_hex':r.payload[:128].hex(' '),'byte_count':len(r.payload)} for r in BinaryState.decode(raw).records]} for raw in result.snapshots],resolution=result.source)
            return status
        if action=='feedback':
            decision=payload.get('decision')
            if decision not in ('accept','reject'):raise ValueError('accept/reject required')
            token=payload.get('token')
            if token not in self.pending:raise ValueError('unknown or already reviewed outcome')
            before,after,evidence=self.pending[token]
            with self.engine.db:
                self.engine.db.execute('INSERT INTO outcome_feedback(decision,input_state,output_state,relationships) VALUES (?,?,?,?)',
                    (decision,before,after,json.dumps(evidence)))
            del self.pending[token]
            return {'status':'recorded','decision':decision}
        if action=='status':
            return {'relationships':list(self.engine.relationships.load()),'opcode_memory':self.engine.paths.stats(),
                    'feedback':self.engine.db.execute('SELECT COUNT(*) FROM outcome_feedback').fetchone()[0]}
        raise ValueError('unsupported app action')


def serve(engine,port,host='127.0.0.1'):
    token=os.environ.get('BSTAE_ACCESS_TOKEN','')
    if host not in ('127.0.0.1','localhost') and len(token)<16:
        raise ValueError('Public binding requires BSTAE_ACCESS_TOKEN with at least 16 characters')
    external=os.environ.get('RENDER_EXTERNAL_HOSTNAME','')
    application=Application(engine)
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def reply(self,status,body,mime='application/json'):
            self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body)
        def valid_host(self):
            known={f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'}
            if external:known.add(external)
            return self.headers.get('Host') in known
        def do_GET(self):
            if self.path=='/health':
                self.reply(200,json.dumps({'status':'ok','engine':'B-STAE','storage':'sqlite','memory_path': 'configured' if os.environ.get('BSTAE_DB_PATH') else 'local'}).encode());return
            if not self.valid_host():self.reply(403,b'Forbidden','text/plain');return
            if self.path!='/':self.reply(404,b'Not found','text/plain');return
            self.reply(200,Path(__file__).with_name('app.html').read_bytes(),'text/html; charset=utf-8')
        def do_POST(self):
            if self.path!='/api' or not self.valid_host():self.reply(403,b'Forbidden','text/plain');return
            origin=self.headers.get('Origin')
            origins={f'http://127.0.0.1:{self.server.server_port}',f'http://localhost:{self.server.server_port}'}
            if external:origins.add('https://'+external)
            if origin and origin not in origins:
                self.reply(403,b'Forbidden','text/plain');return
            if token and not secrets.compare_digest(self.headers.get('X-BSTAE-Token',''),token):
                self.reply(401,b'{"status":"error","reason":"Enter the B-STAE access token"}');return
            if self.headers.get('Content-Type','').split(';')[0]!='application/json':self.reply(415,b'JSON required','text/plain');return
            try:
                size=int(self.headers.get('Content-Length','0'))
                if not 0<size<=1_000_000:raise ValueError('invalid request size')
                result=application.dispatch(json.loads(self.rfile.read(size)))
                self.reply(200,json.dumps(result,ensure_ascii=False).encode())
            except Exception as error:self.reply(400,json.dumps({'status':'error','reason':str(error)}).encode())
    server=HTTPServer((host,port),Handler)
    print(f'B-STAE: http://{host}:{server.server_port}',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--db',default=os.environ.get('BSTAE_DB_PATH','knowledge.sqlite3'));p.add_argument('--port',type=int,default=int(os.environ.get('PORT','8765')));p.add_argument('--host',default='127.0.0.1')
    args=p.parse_args();Path(args.db).parent.mkdir(parents=True,exist_ok=True);engine=Engine(database=args.db)
    try:serve(engine,args.port,args.host)
    finally:engine.close()
