import json
import unittest
from engine import Engine
from meaning_demo import train,CHANGES
from text_memory_demo import PLURAL

class CompleteFlowTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:');train(self.e)
    def tearDown(self):self.e.close()
    def test_unseen_prediction_and_readable_output(self):
        before=self.e.db.total_changes
        for level in ('byte','character'):
            for text,expected in [('three rabbits','four rabbits'),('three cafés','four cafés')]:
                r=self.e.meaning_memory.run(text,'animals','add-one-observation',level)
                self.assertEqual(r['status'],'predicted');self.assertEqual(r['operating_level'],level)
                self.assertEqual(r['outcomes'][0]['record']['count'],4)
                expr=r['outcomes'][0]['expressions']['candidates'][0]
                self.assertEqual(expr['text'],expected)
                decoded=bytes(expr['numbers']).decode('utf-8') if level=='byte' else ''.join(map(chr,expr['numbers']))
                self.assertEqual(decoded,expected);self.assertFalse(r['executed'])
                self.assertTrue(all(type(n) is int for token in r['input']['input_numbers'] for n in token))
        self.assertEqual(before,self.e.db.total_changes)
    def test_no_action_and_unknown_action(self):
        self.assertEqual(self.e.meaning_memory.run('three rabbits','animals')['outcomes'][0]['expressions']['candidates'][0]['text'],'three rabbits')
        self.assertEqual(self.e.meaning_memory.run('three rabbits','animals','untrained')['status'],'unknown')
        self.assertEqual(self.e.meaning_memory.run('five rabbits','animals')['status'],'unknown')
    def test_unknown_expression_does_not_hide_predicted_state(self):
        r=self.e.meaning_memory.run('four rabbits','animals','add-one-observation')
        self.assertEqual(r['status'],'predicted');self.assertEqual(r['outcomes'][0]['record']['count'],5)
        self.assertEqual(r['outcomes'][0]['expressions']['status'],'unknown')
    def test_conflicting_effects_stay_visible(self):
        opposite=[{'input':e['input'],'output':dict(e['output'],count=e['input']['count']-1)} for e in CHANGES]
        self.e.meaning_memory.learn_changes(opposite,'add-one-observation','animals')
        r=self.e.meaning_memory.run('three rabbits','animals','add-one-observation')
        self.assertEqual(r['status'],'ambiguous')
        self.assertEqual({x['record']['count'] for x in r['outcomes']},{2,4})
        self.assertEqual({x['expressions']['candidates'][0]['text'] for x in r['outcomes']},{'two rabbits','four rabbits'})
    def test_numeric_models_and_legacy_compatibility(self):
        model=json.loads(self.e.db.execute('SELECT model FROM bridge_models ORDER BY id').fetchone()[0])
        self.assertEqual(model['level'],'byte')
        for rule in model['template']:
            for value in rule.get('mapping',{}).values():self.assertTrue(all(type(n) is int for n in value))
        legacy={'template':[{'kind':'lookup','field':'count','mapping':{'2':'two','3':'three','4':'four'}},
                            {'kind':'affix','field':'entity','prefix':'','suffix':'s'}],
                'fields':['count','entity'],'examples':[]}
        self.e.db.execute('INSERT INTO bridge_models(context,model) VALUES (?,?)',('"legacy"',json.dumps(legacy)))
        for level in ('byte','character'):
            self.assertEqual(self.e.text_memory.parse('three rabbits','legacy',level)['candidates'][0]['record'],{'count':3,'entity':'rabbit'})
    def test_api_and_bounds(self):
        from app import Application
        self.assertEqual(Application(self.e).dispatch({'action':'meaning_run','text':'three rabbits','context':'animals','label':'add-one-observation'})['status'],'predicted')
        with self.assertRaises(ValueError):self.e.meaning_memory.run('three rabbits','animals',level='word')
        with self.assertRaises(ValueError):self.e.meaning_memory.run('three rabbits','animals',action=123)
