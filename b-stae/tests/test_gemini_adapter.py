import unittest
from unittest.mock import patch
from engine import Engine
from gemini_adapter import GeminiAdapter

def response(text='add 2', finish='STOP'):
    import json
    return {'candidates':[{'finishReason':finish,'content':{'parts':[{'text':json.dumps({'intent_text':text,'reason':'explicit request'})}]}}]}

class GeminiTests(unittest.TestCase):
    def setUp(self): self.engine=Engine(database=':memory:')
    def tearDown(self): self.engine.close()
    def test_local_no_key_no_calls(self):
        with patch.dict('os.environ',{},clear=True):
            adapter=GeminiAdapter(self.engine,lambda *args:self.fail('unexpected call'))
            self.assertEqual(adapter.execute('add 2',100)['decoded'],102)
            self.assertEqual(adapter.interpret('increase it',100)['status'],'not_configured')
    def test_model_checked_execution(self):
        def transport(model,key,body):
            self.assertNotIn('100',body['contents'][0]['parts'][0]['text'])
            self.assertEqual(body['generationConfig']['maxOutputTokens'],512)
            return response()
        with patch.dict('os.environ',{'GEMINI_API_KEY':'test-only'}):
            result=GeminiAdapter(self.engine,transport).execute('increase it by two',100)
        self.assertTrue(result['verified']);self.assertEqual(result['decoded'],102)
        self.assertEqual(result['interpretation']['model_calls'],1)
    def test_invalid_and_incompatible_rejected(self):
        with patch.dict('os.environ',{'GEMINI_API_KEY':'test-only'}):
            for output in [response('run shell'),response('append "x"'),response(finish='MAX_TOKENS'),{}]:
                with self.subTest(output=output),self.assertRaises(ValueError):
                    GeminiAdapter(self.engine,lambda *args:output).execute('do something',100)
    def test_ambiguous_stops(self):
        with patch.dict('os.environ',{'GEMINI_API_KEY':'test-only'}):
            self.assertEqual(GeminiAdapter(self.engine,lambda *args:response('')).execute('make better',100)['status'],'needs_clarification')
    def test_status_hides_key_and_bounds(self):
        with patch.dict('os.environ',{'GEMINI_API_KEY':'test-only'}):
            adapter=GeminiAdapter(self.engine)
            self.assertNotIn('test-only',str(adapter.status()))
            with self.assertRaises(ValueError):adapter.interpret('x'*2001,100)
