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
    def test_cross_origin_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as error:self.request('/api',{'action':'status'},self.token,'https://other.example')
        self.assertEqual(error.exception.code,403)

if __name__=='__main__':unittest.main()
