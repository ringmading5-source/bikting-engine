import unittest
import tempfile
from unittest.mock import patch
from pathlib import Path
from engine import Engine
from app import Application
from storage_backup import backup

class TaskTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:');self.a=Application(self.e)
    def tearDown(self):self.e.close()
    def run_task(self,text='increase the number by 2 then add 3',value=10,expected=15,**extra):
        return self.a.dispatch(dict(action='task_execute',text=text,value=value,goal={'equals':expected},**extra))
    def test_complete_and_memory_without_model(self):
        self.a.gemini.transport=lambda *args:self.fail('unexpected model call')
        first=self.run_task(output_code='111');second=self.run_task(output_code='111')
        self.assertEqual(first['result'],15);self.assertTrue(first['verified'])
        self.assertEqual(second['plan']['source'],'verified_memory');self.assertEqual(second['plan']['model_calls'],0)
        self.assertEqual({i['modality'] for i in first['outputs']},{'text','voice','visual'})
    def test_unseen_registered_composition(self):
        self.e.words.register('small step',intent='add 2');self.e.words.register('large step',intent='add 3')
        result=self.run_task('small step large step',7,12)
        self.assertEqual(result['result'],12)
    def test_wrong_goal_and_budget_do_not_publish(self):
        self.assertEqual(self.run_task(expected=99)['status'],'goal_mismatch')
        self.assertEqual(self.e.db.execute('SELECT COUNT(*) FROM verified_task_plans').fetchone()[0],0)
        with self.assertRaises(ValueError):self.run_task(max_actions=1)
    def test_cycle_and_unknown_stop(self):
        self.e.words.register('loop',children=['loop'])
        self.assertEqual(self.run_task('loop')['status'],'cycle')
        self.assertEqual(self.run_task('do absolutely anything')['status'],'needs_clarification')
    def test_typed_text_and_artifact_readback(self):
        result=self.run_task('append " world"','hello','hello world')
        file=self.a.dispatch({'action':'artifact_create','name':'result.txt','content':result['result']})
        import base64
        self.assertEqual(base64.b64decode(file['base64']),b'hello world')
        with self.assertRaises(ValueError):self.a.tasks.artifact('../escape','text')
    def test_wav_decode(self):
        import base64,io,wave
        buf=io.BytesIO()
        with wave.open(buf,'wb') as wav:
            wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(8000);wav.writeframes(b'\0\0\1\0')
        value=self.a.tasks.input({'format':'wav','base64':base64.b64encode(buf.getvalue()).decode()})
        self.assertEqual(value['audio']['samples'],[0,1])
    def test_backup_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            engine=Engine(database=directory+'/source.db');app=Application(engine)
            app.tasks.execute('add 2',3,{'equals':5});engine.close()
            backup(directory+'/source.db',directory+'/copy.db')
            restored=Engine(database=directory+'/copy.db')
            self.assertEqual(Application(restored).tasks.execute('add 2',3,{'equals':5})['plan']['source'],'verified_memory');restored.close()
            with self.assertRaises(FileExistsError):backup(directory+'/source.db',directory+'/copy.db')
    def test_internal_only_and_missing_goal(self):
        self.assertEqual(self.run_task(output_code='000')['outputs'],[])
        with self.assertRaises(ValueError):self.a.tasks.execute('add 2',3,None)
