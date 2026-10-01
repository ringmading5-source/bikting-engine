import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import unittest
import urllib.request
import urllib.error

class RenderHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory();cls.token=secrets.token_urlsafe(24)
        env=dict(os.environ,PORT='0',BSTAE_ACCESS_TOKEN=cls.token,RENDER_EXTERNAL_HOSTNAME='bstae-test.onrender.com',BSTAE_DB_PATH=str(Path(cls.tmp.name)/'memory.db'))
        cls.proc=subprocess.Popen(['python3','app.py','--host','0.0.0.0'],cwd=Path(__file__).resolve().parents[1],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        line=cls.proc.stdout.readline().strip()
        if not line:raise RuntimeError(cls.proc.stderr.read())
        cls.url=line.split(' ',1)[1].replace('0.0.0.0','127.0.0.1')
    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate();cls.proc.wait(timeout=5);cls.proc.stdout.close();cls.proc.stderr.close();cls.tmp.cleanup()
    def request(self,path,body=None,token=None,origin='https://bstae-test.onrender.com'):
        headers={'Host':'bstae-test.onrender.com','Origin':origin,'Content-Type':'application/json'}
        if token is not None:headers['X-BSTAE-Token']=token
        request=urllib.request.Request(self.url+path,headers=headers,data=None if body is None else json.dumps(body).encode())
        return urllib.request.urlopen(request,timeout=5)
    def test_health_and_page_through_external_host(self):
        with self.request('/health') as r:self.assertEqual(json.load(r)['status'],'ok')
        with self.request('/') as r:self.assertIn(b'Access token',r.read())
    def test_token_gate_and_authorized_api(self):
        with self.assertRaises(urllib.error.HTTPError) as error:self.request('/api',{'action':'status'})
        self.assertEqual(error.exception.code,401)
        with self.request('/api',{'action':'intent_execute','value':3,'intent':'add 2'},self.token) as r:self.assertEqual(json.load(r)['decoded'],5)
    def test_removed_training_routes_are_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as error:self.request('/api',{'action':'vector_train'},self.token)
        self.assertEqual(error.exception.code,400)
    def test_connected_pattern_workflow_over_http(self):
        def call(payload):
            with self.request('/api',payload,self.token) as response:return json.load(response)
        for context,multiplier,offset in [('http:increment',1,1),('http:double',2,0)]:
            for units in ([1,3,5],[2,4,6,8]):
                call({'action':'pattern_learn_pair','before':units,'after':[multiplier*x+offset for x in units],
                      'level':'http:number','context':context,'source':'http:test'})
            call({'action':'relationship_discover','level':'http:number','context':context})
        result=call({'action':'pattern_plan','units':[20,30],'target':[42,62],'level':'http:number',
                     'contexts':['http:increment','http:double'],'max_depth':2})
        self.assertEqual(result['status'],'predicted_goal_matched')
        self.assertEqual(len(result['plan']),2)
        self.assertFalse(result['outcome_verified'])
        selected=call({'action':'pattern_select','units':[20,30],'level':'http:number','context':'http:increment','goal':[21,31]})
        program=selected['preferred'][0]['hypotheses'][0]['program']
        feedback=call({'action':'pattern_feedback','units':[20,30],'actual':[99,99],'program':program,
                       'level':'http:number','context':'http:increment','goal':[21,31],'source':'http:contradiction'})
        self.assertFalse(feedback['prediction_matched'])
        self.assertEqual(len(call({'action':'pattern_outcomes','level':'http:number','context':'http:increment'})['outcomes']),1)
        with self.request('/') as response:self.assertIn(b'Connected pattern learning',response.read())

    def test_cross_origin_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as error:self.request('/api',{'action':'status'},self.token,'https://other.example')
        self.assertEqual(error.exception.code,403)

if __name__=='__main__':unittest.main()
