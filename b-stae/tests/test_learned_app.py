import tempfile
import unittest
from pathlib import Path
from app import Application
from engine import Engine

class LearnedAppTests(unittest.TestCase):
    def test_web_routes_and_restart_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            path=str(Path(directory)/'memory.db')
            engine=Engine(database=path)
            app=Application(engine)
            environment=app.dispatch({'action':'learned_plan_example'})
            payload=dict(environment,action='learned_plan',initial={'stock':10,'incoming':5,'outgoing':3},target={'stock':12,'incoming':5,'outgoing':3})
            result=app.dispatch(payload)
            self.assertEqual(result['status'],'goal_satisfied');self.assertEqual(len(result['plan']),2)
            self.assertEqual(result['model_calls'],0)
            example=app.dispatch({'action':'coupled_example'})
            learned=app.dispatch(example['training'])
            model_id=learned['model_id']
            engine.close()
            engine=Engine(database=path)
            try:
                app=Application(engine)
                self.assertEqual(app.dispatch(payload)['status'],'goal_satisfied')
                text=app.dispatch({'action':'text_transition_answer','model_id':model_id,'text':'I have seven items and receive nine more. How many now?'})
                self.assertEqual(text['prediction']['state']['stock'],16)
                self.assertEqual(text['model_calls'],0)
                self.assertEqual(app.dispatch(dict(payload,max_depth=1))['status'],'bounded')
                self.assertEqual(app.dispatch({'action':'text_transition_answer','model_id':model_id,'text':'What is chemistry?'})['status'],'unsupported')
            finally:engine.close()
