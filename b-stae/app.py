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
        from chatbot import Chatbot
        self.chat=Chatbot(engine)
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
        self._web=None
        self._discovery=None
    @property
    def web(self):
        if self._web is None:
            from web_knowledge import WebKnowledge
            self._web=WebKnowledge(self.engine)
        return self._web
    @property
    def discovery(self):
        if self._discovery is None:
            from web_intent_loop import WebIntentLoop
            self._discovery=WebIntentLoop(self.engine,self.web)
        return self._discovery
    def dispatch(self,payload):
        if not isinstance(payload,dict):raise ValueError('request object required')
        action=payload.get('action')
        if action in ('media_observe','media_predict','media_inspect'):
            from media_inputs import MediaInputs
            media=MediaInputs(self.engine)
            if action=='media_observe':return media.observe(payload.get('concept'),payload.get('value'),payload.get('source'),payload.get('context'))
            if action=='media_predict':return media.predict(payload.get('value'),payload.get('context'))
            return media.inspect(payload.get('values'),payload.get('context'))
        if action=='chat_send':return self.chat.send(payload.get('text'),payload.get('conversation'),payload.get('context'))
        if action=='chat_history':return self.chat.history(payload.get('conversation'))
        if action=='chat_new':return {'conversation':self.chat.conversation()}
        if action=='chat_teach':return self.chat.teach(payload.get('text'),payload.get('reply'),payload.get('source','user:chat-reply'))
        if action=='chat_demo':return self.chat.demo()
        if action=='text_behavior_observe':return self.engine.text_behavior.observe(payload.get('before'),payload.get('after'),payload.get('source'),payload.get('context'),payload.get('mode','character'))
        if action=='text_behavior_learn':return self.engine.text_behavior.learn(payload.get('episodes'),payload.get('source'),payload.get('context'),payload.get('mode','character'))
        if action=='text_behavior_predict':return self.engine.text_behavior.predict(payload.get('text'),payload.get('context'),payload.get('mode','character'),payload.get('path',False))
        if action=='text_behavior_inventory':return self.engine.text_behavior.inventory(payload.get('context'),payload.get('mode','character'))
        if action=='transfer_learn':return self.engine.transfer.learn(payload.get('examples'),payload.get('requirements'),payload.get('contexts'),payload.get('source'))
        if action=='transfer_solve':return self.engine.transfer.solve(payload.get('initial'),payload.get('target'),payload.get('adapter'),payload.get('conditions'),payload.get('max_depth',4),payload.get('max_nodes',128))
        if action=='transfer_feedback':return self.engine.transfer.feedback(payload.get('adapter'),payload.get('example'),payload.get('source'))
        if action=='behavior_compose':return self.engine.composition.solve(payload.get('initial'),payload.get('target'),payload.get('contexts'),payload.get('max_depth',4),payload.get('max_nodes',128))
        if action=='knowledge_behavior_observe':return self.engine.behavior.observe(payload.get('before'),payload.get('after'),payload.get('source'),payload.get('context'))
        if action=='knowledge_behavior_predict':return self.engine.behavior.predict(payload.get('state'),payload.get('context'))
        if action=='knowledge_behavior_learn_episodes':return self.engine.behavior.learn_episodes(payload.get('episodes'),payload.get('source'),payload.get('context'))
        if action=='knowledge_behavior_predict_path':return self.engine.behavior.predict_path(payload.get('state'),payload.get('context'))
        if action=='knowledge_behavior_inventory':return {'models':self.engine.behavior.inventory(payload.get('context'))}
        if action=='recursive_text_train':return self.engine.recursive_text.train(payload.get('observations'),payload.get('context'),payload.get('mode','character'),payload.get('include_history',True))
        if action=='recursive_text_predict':return self.engine.recursive_text.predict(payload.get('text'),payload.get('context'),payload.get('mode','character'))
        if action=='recursive_text_inventory':return self.engine.recursive_text.inventory(payload.get('context'),payload.get('mode','character'))
        if action=='adaptive_pattern_observe':return self.engine.adaptive_patterns.observe(payload.get('before'),payload.get('after'),payload.get('source'),payload.get('context'),payload.get('mode','character'))
        if action=='adaptive_pattern_predict':return self.engine.adaptive_patterns.predict(payload.get('text'),payload.get('context'),payload.get('mode','character'))
        if action=='adaptive_pattern_inventory':return {'models':self.engine.adaptive_patterns.inventory(payload.get('context'),payload.get('mode','character'))}
        if action=='knowledge_question_learn':return self.engine.question_knowledge.learn_questions(payload.get('examples'),payload.get('label'),payload.get('context'),payload.get('mode','character'))
        if action=='knowledge_fact_learn':return self.engine.question_knowledge.learn_facts(payload.get('facts'),payload.get('context'))
        if action=='knowledge_question_answer':return self.engine.question_knowledge.answer(payload.get('question'),payload.get('context'),payload.get('mode','character'))
        if action=='internal_state_learn':return self.engine.internal_states.learn(payload.get('examples'),payload.get('context'),payload.get('mode','character'))
        if action=='internal_state_predict':return self.engine.internal_states.predict(payload.get('text'),payload.get('context'),payload.get('mode','character'),payload.get('strategy','indexed'))
        if action=='boundary_state_observe':return {'state_id':self.engine.boundary_states.observe(payload.get('units'),payload.get('payload'),payload.get('source'),payload.get('context'),payload.get('mode','character'))}
        if action=='boundary_state_search':return self.engine.boundary_states.search(payload.get('units'),payload.get('context'),payload.get('mode','character'),payload.get('strategy','indexed'),payload.get('max_candidates',2048),payload.get('max_nodes',65536))
        if action=='composed_state_learn':return self.engine.composed_states.learn(payload.get('examples'),payload.get('context'),payload.get('mode','character'))
        if action=='composed_state_predict':return self.engine.composed_states.predict(payload.get('text'),payload.get('context'),payload.get('mode','character'),payload.get('strategy','indexed'))
        if action=='composed_state_compose':return self.engine.composed_states.compose(payload.get('text'),payload.get('contexts'),payload.get('mode','character'),payload.get('max_candidates',32))
        if action=='composed_state_inventory':return {'rules':self.engine.composed_states.inventory(payload.get('context'),payload.get('mode','character'))}
        if action=='recursive_pattern_learn':return self.engine.recursive_patterns.learn(payload.get('examples'),payload.get('context'),payload.get('mode','character'),payload.get('rounds',24),payload.get('max_depth',8),payload.get('min_documents',2),payload.get('include_history',True))
        if action=='recursive_pattern_encode':return self.engine.recursive_patterns.encode(payload.get('text'),payload.get('context'),payload.get('mode','character'))
        if action=='recursive_pattern_inventory':return self.engine.recursive_patterns.inventory(payload.get('context'),payload.get('mode','character'))
        if action=='recursive_pattern_decode':return {'text':self.engine.recursive_patterns.decode(payload.get('units'),payload.get('mode','character'))}
        if action=='meaning_run':return self.engine.meaning_memory.run(payload.get('text'),payload.get('context'),payload.get('label'),payload.get('level','byte'))
        if action=='meaning_learn_expressions':return self.engine.meaning_memory.learn_expressions(payload.get('examples'),payload.get('context'))
        if action=='meaning_learn_relations':return self.engine.meaning_memory.learn_relations(payload.get('examples'),payload.get('context'))
        if action=='meaning_learn_changes':return self.engine.meaning_memory.learn_changes(payload.get('examples'),payload.get('label'),payload.get('context'))
        if action=='meaning_inspect':return self.engine.meaning_memory.inspect(payload.get('text'),payload.get('context'))
        if action=='meaning_read_field':return self.engine.meaning_memory.read_field(payload.get('text'),payload.get('field'),payload.get('context'))
        if action=='numeric_text_encode':return self.engine.numeric_text.encode(payload.get('text'))
        if action=='numeric_text_decode':return self.engine.numeric_text.decode(payload.get('sentence_id'))
        if action=='numeric_text_decode_tokens':return {'text':self.engine.numeric_text.decode_tokens(payload.get('token_ids'))}
        if action=='claim_learn':return self.engine.claims.learn(payload.get('examples'),payload.get('source'),payload.get('context'))
        if action=='claim_parse':return self.engine.claims.parse(payload.get('text'),payload.get('context'),payload.get('level','byte'))
        if action=='claim_inspect':return self.engine.claims.inspect(payload.get('text'),payload.get('claim_context'),payload.get('context'),payload.get('level','byte'))
        if action=='shared_concept_observe':return self.engine.shared_concepts.observe(payload.get('concept'),payload.get('value'),payload.get('source'),payload.get('context'))
        if action=='shared_concept_predict':return self.engine.shared_concepts.predict(payload.get('value'),payload.get('context'))
        if action=='shared_concept_inspect':return self.engine.shared_concepts.inspect(payload.get('values'),payload.get('context'))
        if action=='coherence_observe':return self.engine.coherence.observe(payload.get('assertion'),payload.get('source'),payload.get('supersedes'))
        if action=='coherence_check':return self.engine.coherence.check(payload.get('record'),payload.get('context'))
        if action=='coherence_inspect':return self.engine.coherence.inspect(payload.get('text'),payload.get('role_context'),payload.get('context'),payload.get('level','byte'))
        if action=='role_learn':return self.engine.roles.learn(payload.get('examples'),payload.get('context'))
        if action=='role_parse':return self.engine.roles.parse(payload.get('text'),payload.get('context'),payload.get('level','byte'))
        if action=='role_evaluate':return self.engine.roles.evaluate(payload.get('examples'),payload.get('context'),payload.get('level','byte'))
        if action=='text_memory_learn':return self.engine.text_memory.learn(payload.get('examples'),payload.get('context'))
        if action=='text_memory_parse':return self.engine.text_memory.parse(payload.get('text'),payload.get('context'),payload.get('level','byte'))
        if action=='text_memory_express':return self.engine.text_memory.express(payload.get('record'),payload.get('context'),payload.get('level','byte'))
        if action=='memory_logic_learn':return self.engine.memory_logic.learn(payload.get('examples'),payload.get('context'))
        if action=='memory_logic_predict':return self.engine.memory_logic.predict(payload.get('record'),payload.get('context'))
        if action=='span_question_learn':return self.engine.span_questions.learn(payload.get('span_model_id'),payload.get('examples'),payload.get('validation'),payload.get('context'))
        if action=='unlabeled_span_learn':return self.engine.unlabeled_spans.learn(payload.get('passages'),payload.get('context'))
        if action=='unlabeled_span_predict':return self.engine.unlabeled_spans.predict(payload.get('model_id'),payload.get('text'),payload.get('max_expansions',10000))
        if action=='unlabeled_span_evaluate':return self.engine.unlabeled_spans.evaluate(payload.get('model_id'),payload.get('cases'))
        if action=='unlabeled_pattern_learn':return self.engine.unlabeled_patterns.learn(payload.get('passages'),payload.get('context'))
        if action=='unlabeled_pattern_predict':return self.engine.unlabeled_patterns.predict(payload.get('model_id'),payload.get('text'))
        if action=='unlabeled_pattern_evaluate':return self.engine.unlabeled_patterns.evaluate(payload.get('model_id'),payload.get('cases'))
        if action=='passage_learn':return self.engine.passage_knowledge.learn(payload.get('text'),payload.get('source'),payload.get('context'))
        if action=='passage_answer':return self.engine.passage_knowledge.answer(payload.get('question'),payload.get('context'),payload.get('max_depth',2),payload.get('max_expansions',1000))
        if action=='passage_evaluate':return self.engine.passage_knowledge.evaluate(payload.get('cases'),payload.get('context'),payload.get('max_depth',2))
        if action=='relationship_compose_answer':
            return self.engine.relationship_composition.answer(payload.get('facts'),payload.get('question'),payload.get('context'),payload.get('max_depth',2),payload.get('max_facts',48),payload.get('max_expansions',1000))
        if action=='text_transform_learn':return self.engine.text_transforms.learn(payload.get('examples'),payload.get('validation'),payload.get('context'))
        if action=='text_transform_predict':return self.engine.text_transforms.predict(payload.get('text'),payload.get('context'))
        if action=='text_relation_learn':return self.engine.text_relations.learn(payload.get('examples'),payload.get('context'))
        if action=='text_relation_transform':return self.engine.text_relations.transform(payload.get('statement'),payload.get('context'))
        if action=='text_relation_answer':return self.engine.text_relations.answer(payload.get('statement'),payload.get('question'),payload.get('context'))
        if action=='sentence_predict':
            return self.engine.sentences.predict(payload.get('text'),payload.get('context'),payload.get('window',3),payload.get('max_tokens',24),payload.get('sentence_end',False))
        if action=='sentence_continue':
            return self.engine.sentences.continue_sentence(payload.get('text'),payload.get('context'),payload.get('max_tokens',24))
        if action=='sentence_evaluate':return self.engine.sentences.evaluate(payload.get('cases'),payload.get('context'))
        if action=='text_gap_learn':
            return self.engine.text_gaps.learn(payload.get('text'),payload.get('source'),payload.get('context'),payload.get('window',3))
        if action=='text_gap_predict':
            return self.engine.text_gaps.predict(payload.get('text'),payload.get('context'),payload.get('window',3))
        if action=='text_first_predict':
            return self.engine.text_gaps.predict_first(payload.get('text'),payload.get('context'),payload.get('window',3))
        if action=='text_gap_evaluate':return self.engine.text_gaps.evaluate(payload.get('cases'),payload.get('context'))
        if action=='text_gap_baseline':return self.engine.text_gaps.baseline(payload.get('context'))
        if action=='pattern_dataset_import':
            from pattern_dataset import PatternDataset
            return PatternDataset(self.engine).ingest(payload.get('name'),payload.get('records'))
        if action=='pattern_dataset_evaluate':
            from pattern_dataset import PatternDataset
            return PatternDataset(self.engine).evaluate(payload.get('name'))
        if action=='request_pattern_learn':
            return self.engine.request_patterns.learn(payload.get('text'),payload.get('context'),payload.get('source'))
        if action=='request_pattern_route':return self.engine.request_patterns.route(payload.get('text'))
        if action=='multimodal_pattern_learn':
            return self.engine.multimodal_patterns.learn(payload.get('before'),payload.get('after'),payload.get('context'),payload.get('source'))
        if action=='multimodal_pattern_discover':
            return self.engine.multimodal_patterns.discover(payload.get('value'),payload.get('context'))
        if action=='multimodal_pattern_predict':
            return self.engine.multimodal_patterns.predict(payload.get('value'),payload.get('context'))
        if action=='multimodal_pattern_request':
            return self.engine.multimodal_patterns.request(payload.get('text'),payload.get('value'))
        if action=='pattern_select':
            return self.engine.pattern_runtime.select(payload.get('units'),payload.get('level'),payload.get('context'),payload.get('goal'))
        if action=='pattern_feedback':
            return self.engine.pattern_runtime.feedback(payload.get('units'),payload.get('actual'),payload.get('program'),payload.get('level'),payload.get('source'),payload.get('context'),payload.get('goal'))
        if action=='pattern_outcomes':
            return {'outcomes':self.engine.pattern_runtime.outcomes(payload.get('level'),payload.get('context'))}
        if action=='pattern_plan':
            return self.engine.pattern_runtime.plan(payload.get('units'),payload.get('target'),payload.get('level'),payload.get('contexts'),payload.get('max_depth',4),payload.get('max_nodes',256),payload.get('max_units',128))
        if action=='relationship_discover':
            return self.engine.discovery_patterns.discover(payload.get('level'),payload.get('context'),payload.get('max_programs',512),payload.get('max_parts',2),payload.get('max_stride',4),payload.get('endpoint_radius',3))
        if action=='relationship_predict':
            return self.engine.discovery_patterns.predict(payload.get('units'),payload.get('level'),payload.get('context'))
        if action=='relationship_inventory':
            return {'hypotheses':self.engine.discovery_patterns.inventory(payload.get('level'),payload.get('context'))}
        if action=='pattern_observe':
            return self.engine.patterns.observe_text(payload.get('text'),payload.get('source'),payload.get('context'))
        if action=='pattern_find':
            return {'matches':self.engine.patterns.find(payload.get('units'),payload.get('level'),payload.get('context'))}
        if action=='pattern_complete':
            return self.engine.patterns.complete(payload.get('units'),payload.get('level'),payload.get('context'))
        if action=='pattern_learn_pair':
            return {'example':self.engine.patterns.learn_pair(payload.get('before'),payload.get('after'),payload.get('level'),payload.get('source'),payload.get('context'))}
        if action=='pattern_predict':
            return self.engine.patterns.predict(payload.get('units'),payload.get('level'),payload.get('context'))
        if action=='pattern_stats':return self.engine.patterns.stats()
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


def serve(engine,port,host='127.0.0.1',chat_home=False):
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
            pages={'/':'chat.html' if chat_home else 'app.html','/chat':'chat.html','/learn':'media.html','/workspace':'app.html'}
            if self.path not in pages:self.reply(404,b'Not found','text/plain');return
            asset=Path(__file__).with_name(pages[self.path])
            if pages[self.path]=='chat.html' and not asset.exists():
                asset=Path(__file__).parent.parent/'chatbot'/'index.html'
            self.reply(200,asset.read_bytes(),'text/html; charset=utf-8')
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
