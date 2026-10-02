import tempfile
import unittest
from pathlib import Path
from engine import Engine
from app import Application
from bstae import Model

class ChatTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:');self.app=Application(self.e)
    def tearDown(self):self.e.close()
    def test_greeting_and_conversation(self):
        r=self.app.dispatch({'action':'chat_send','text':'Hello!'})
        self.assertEqual(r['reply'],'Hello! How can I help?')
        cid=r['conversation']
        r=self.app.dispatch({'action':'chat_send','text':'Hi','conversation':cid})
        self.assertEqual(r['conversation'],cid)
        h=self.app.dispatch({'action':'chat_history','conversation':cid})
        self.assertEqual([m['role'] for m in h['messages']],['user','assistant','user','assistant'])
        other=self.app.dispatch({'action':'chat_new'})['conversation']
        self.assertEqual(self.app.chat.history(other)['messages'],[])
    def test_exact_teaching_conflicts_and_questions(self):
        self.assertEqual(self.app.chat.send('What is chemistry?')['status'],'unknown')
        self.app.chat.teach('What is chemistry?','A supplied explanation.','user:test')
        self.assertEqual(self.app.chat.send('What is chemistry?')['reply'],'A supplied explanation.')
        self.assertEqual(self.app.chat.send('Say hello')['status'],'unknown')
        self.assertEqual(self.app.chat.send('Hello?')['status'],'unknown')
        self.app.chat.teach('What is chemistry?','A different explanation.','user:conflict')
        self.assertEqual(self.app.chat.send('What is chemistry?')['status'],'ambiguous')
    def test_sample_claims_and_no_implicit_learning(self):
        self.assertEqual(self.app.chat.send('can cat speak English?')['status'],'unknown')
        before=self.e.db.execute('SELECT count(*) FROM claim_forms').fetchone()[0]
        self.app.chat.send('unknown phrase')
        self.assertEqual(self.e.db.execute('SELECT count(*) FROM claim_forms').fetchone()[0],before)
        context=self.app.chat.demo()['context']
        self.assertEqual(self.app.chat.send('can cat speak English?',context=context)['reply'],'No, according to the stored relationship evidence.')
        self.assertEqual(self.app.chat.send('cat does not speak English.',context=context)['status'],'supported')
        self.assertEqual(self.app.chat.send('cat speaks English.',context=context)['status'],'conflict')
        count=self.e.db.execute('SELECT count(*) FROM claim_observations').fetchone()[0]
        self.app.chat.demo()
        self.assertEqual(self.e.db.execute('SELECT count(*) FROM claim_observations').fetchone()[0],count)
    def test_validation_and_long_input(self):
        for text in ('',' '*3,'x'*513,'\ud800'):
            with self.assertRaises(ValueError):self.app.chat.send(text)
        with self.assertRaises(ValueError):self.app.chat.history(None)
        with self.assertRaises(ValueError):self.app.chat.history('0'*32)
        self.assertEqual(self.app.chat.send('word '*40)['status'],'unknown')
    def test_checkpoint(self):
        with tempfile.TemporaryDirectory() as d:
            with Model() as m:
                m.request('chat_teach',text='Good morning',reply='Good morning!')
                r=m.request('chat_send',text='Good morning');cid=r['conversation']
                m.save(Path(d)/'checkpoint')
            with Model.load(Path(d)/'checkpoint') as m:
                self.assertEqual(m.request('chat_send',text='Good morning',conversation=cid)['reply'],'Good morning!')
                self.assertEqual(len(m.request('chat_history',conversation=cid)['messages']),4)
