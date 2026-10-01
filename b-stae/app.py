"""Local B-STAE interface. Run python app.py and open the printed loopback URL."""
import argparse
from http.server import BaseHTTPRequestHandler,HTTPServer
import json
from pathlib import Path
import os
import secrets
from urllib.parse import urlsplit
from engine import Engine
from core import BinaryState,decode_outputs

class Application:
    def __init__(self,engine):
        self.engine=engine
        from gemini_adapter import GeminiAdapter
        self.gemini=GeminiAdapter(engine)
        from task_runtime import TaskRuntime
        self.tasks=TaskRuntime(engine,self.gemini)
        from goal_planner import GoalPlanner
        self.goals=GoalPlanner(self.tasks)
        from transition_learning import TransitionLearning
        self.transitions=TransitionLearning(engine)
        from coupled_transition_learning import CoupledTransitionLearning
        self.coupled=CoupledTransitionLearning(engine)
        from learned_planner import LearnedTransitionPlanner
        self.learned_planner=LearnedTransitionPlanner(engine)
        from text_learning import TextPatternLearning
        self.text_learning=TextPatternLearning(engine)
        from web_knowledge import WebKnowledge
        self.web=WebKnowledge(engine)
        from web_intent_loop import WebIntentLoop
        self.discovery=WebIntentLoop(engine,self.web)
    def dispatch(self,payload):
        if not isinstance(payload,dict):raise ValueError('request object required')
        action=payload.get('action')
        if action=='text_learning_example':
            from text_learning_demo import example
            return dict(example(),action='text_pattern_learn')
        if action=='text_pattern_learn':return self.text_learning.learn(payload.get('examples'),payload.get('validation'))
        if action=='text_pattern_parse':return self.text_learning.parse(payload.get('text_model_id'),payload.get('text'))
        if action=='text_pattern_answer':return self.text_learning.answer(payload.get('text_model_id'),payload.get('model_id'),payload.get('text'))
        if action=='text_pattern_feedback':return self.text_learning.feedback(payload.get('text_model_id'),payload.get('example'))
        if action=='learned_plan':
            return self.learned_planner.solve(payload.get('initial'),payload.get('target'),payload.get('model_ids'),payload.get('context'),payload.get('relationships'),payload.get('max_depth',4),payload.get('max_nodes',128),payload.get('max_frontier',128))
        if action=='learned_plan_example':
            from learned_planner_demo import train, CONTEXT, RELATIONSHIPS
            return {'model_ids':train(self.engine),'context':CONTEXT,'relationships':RELATIONSHIPS,'source':'synthetic:composition-demo-v1','model_calls':0}
        if action=='text_transition_answer':
            from text_transition import answer
            return answer(self.coupled,payload.get('model_id'),payload.get('text'))
        if action=='coupled_example':
            from evaluation import demo
            return demo()
        if action=='coupled_learn':return self.coupled.learn(payload.get('examples'),payload.get('validation'))
        if action=='coupled_predict':return self.coupled.predict(payload.get('model_id'),payload.get('state'),payload.get('transition_action'),payload.get('context'),payload.get('relationships'),payload.get('allow_extrapolation',False))
        if action=='coupled_feedback':return self.coupled.feedback(payload.get('model_id'),payload.get('observation'))
        if action=='evaluation_run':
            from evaluation import evaluate
            return evaluate()
        if action=='transition_example':
            from transition_demo import example
            return example()
        if action=='transition_learn':return self.transitions.learn(payload.get('examples'),payload.get('validation'))
        if action=='transition_predict':return self.transitions.predict(payload.get('model_id'),payload.get('state'),payload.get('transition_action'),payload.get('context'),payload.get('relationships'),payload.get('allow_extrapolation',False))
        if action=='transition_feedback':return self.transitions.feedback(payload.get('model_id'),payload.get('observation'))
        if action=='behavior_learn':return self.goals.learning.learn(payload.get('examples'),payload.get('validation'),payload.get('source'))
        if action=='behavior_hypotheses':return {'hypotheses':self.goals.learning.inventory()}
        if action=='behavior_feedback':return self.goals.learning.feedback(payload.get('hypothesis_id'),payload.get('example'))
        if action=='goal_execute':return self.goals.execute(payload.get('value'),payload.get('goal'),payload.get('candidates'),payload.get('max_depth',4),payload.get('max_nodes',128),payload.get('max_frontier',128))
        if action=='behavior_inventory':return {'behaviors':self.tasks.behaviors.inventory()}
        if action=='task_execute':return self.tasks.execute(payload.get('text'),payload.get('value'),payload.get('goal'),payload.get('output_code','101'),payload.get('max_actions',16),payload.get('use_gemini',False))
        if action=='input_decode':return {'value':self.tasks.input(payload.get('value'))}
        if action=='artifact_create':return self.tasks.artifact(payload.get('name'),payload.get('content'),payload.get('mime','text/plain'))
        if action=='storage_status':
            path=self.engine.db.execute('PRAGMA database_list').fetchone()[2]
            return {'backend':'sqlite','configured_path':bool(os.environ.get('BSTAE_DB_PATH')),'persistent_disk_verified':False,'memory_only':not bool(path),'reason':'A configured path does not prove the host has a persistent disk.'}
        if action=='gemini_status':return self.gemini.status()
        if action=='gemini_interpret':return self.gemini.interpret(payload.get('text'),payload.get('value'))
        if action=='gemini_execute':return self.gemini.execute(payload.get('text'),payload.get('value'))
        if action=='representation_example':
            from representation_demo import demo_request
            return demo_request()
        if action=='representation_demo':
            from representation_demo import demo_request
            return self.dispatch(demo_request())
        if action=='represent':
            from representation import represent
            return represent(payload.get('state'))
        if action=='representation_transition':
            return self.engine.representations.transition(payload.get('state'),payload.get('steps'),payload.get('max_steps',16))
        if action=='representation_trajectory':
            return self.engine.representations.get(payload.get('trajectory_id'))
        if action=='capability_inventory':return {'capabilities':self.engine.capabilities.inventory()}
        if action=='capability_execute':
            return self.engine.capabilities.execute(payload.get('request'),payload.get('values'),payload.get('title','B-STAE graph'))
        if action=='inspect_relationships':
            return self.engine.extraction.inspect(payload.get('subject'))
        if action=='discovery_start':
            return self.discovery.start(payload.get('texts'),payload.get('value'),payload.get('urls'),payload.get('max_searches',3),payload.get('alphabetical',False))
        if action=='discovery_step':return self.discovery.step(payload.get('job'))
        if action=='discovery_status':return self.discovery.get(payload.get('job'))
        if action=='discovery_stop':return self.discovery.stop(payload.get('job'))
        if action=='discovery_resume':return self.discovery.resume(payload.get('job'))
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
        if action=='modality_register':
            return self.engine.modalities.register(payload.get('value'),payload.get('intent'),payload.get('source'))
        if action=='modality_transform':
            return self.engine.modalities.transform(payload.get('value'),payload.get('program'))
        if action=='modality_programs':
            return {'programs':self.engine.modalities.programs()}
        if action=='research':
            try:return self.web.research(payload.get('query'),payload.get('url'))
            except Exception as error:return {'status':'web_error','reason':str(error),'sources':[]}
        if action=='status':
            return {'relationships':list(self.engine.relationships.load()),'opcode_memory':self.engine.paths.stats()}
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
                self.reply(200,json.dumps({'status':'ok','engine':'B-STAE','release':'knowledge-retrieval-v1','revision':os.environ.get('RENDER_GIT_COMMIT','local'),'storage':'sqlite','memory_path': 'configured' if os.environ.get('BSTAE_DB_PATH') else 'local'}).encode());return
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
