import unittest
import tempfile
from engine import Engine
from app import Application

def observation(x,y=None):
    return {'before':{'stock':x,'total_received':2*x},'after':{'stock':x+5 if y is None else y,'total_received':2*x+5},'action':'receive_batch','context':{'warehouse':'A','batch_units':'5'},'relationships':[{'from':'item','kind':'stored_in','to':'warehouse_A'}],'outcome':'observed','source':'simulator:inventory-v1'}

class TransitionTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:');self.a=Application(self.e);self.t=self.a.transitions
    def tearDown(self):self.e.close()
    def learn(self):return self.t.learn([observation(0),observation(10),observation(20)],[observation(5)])
    def predict(self,ident,x=15,**kwargs):
        o=observation(x)
        return self.t.predict(ident,o['before'],o['action'],o['context'],o['relationships'],**kwargs)
    def test_unseen_multifield_prediction_and_inverse(self):
        model=self.learn();result=self.predict(model['model_id'])
        self.assertEqual(result['state'],{'stock':20,'total_received':35});self.assertTrue(result['inverse_consistent'])
        self.assertFalse(result['verified_outcome']);self.assertEqual(result['model_calls'],0)
    def test_action_context_and_relationship_gates(self):
        ident=self.learn()['model_id'];o=observation(15)
        for field,value in [('action','dispatch_batch'),('context',{'warehouse':'B','batch_units':'5'}),('relationships',[])]:
            changed=dict(o);changed[field]=value
            result=self.t.predict(ident,changed['before'],changed['action'],changed['context'],changed['relationships'])
            self.assertEqual(result['status'],'context_mismatch')
    def test_extrapolation_requires_flag(self):
        ident=self.learn()['model_id']
        self.assertEqual(self.predict(ident,25)['status'],'outside_observed_range')
        self.assertTrue(self.predict(ident,25,allow_extrapolation=True)['extrapolated'])
    def test_validation_failure_never_saved(self):
        result=self.t.learn([observation(0),observation(10),observation(20)],[observation(5,99)])
        self.assertEqual(result['status'],'validation_failed')
        self.assertEqual(self.e.db.execute('SELECT COUNT(*) FROM contextual_transition_models').fetchone()[0],0)
    def test_training_nonlinearity_and_leakage(self):
        self.assertEqual(self.t.learn([observation(0),observation(10),observation(20,99)],[observation(5)])['status'],'unsupported_pattern')
        with self.assertRaises(ValueError):self.t.learn([observation(0),observation(10),observation(20)],[observation(10)])
    def test_feedback_disables_without_reactivation(self):
        ident=self.learn()['model_id'];self.assertEqual(self.t.feedback(ident,observation(15,999))['status'],'hypothesis_disabled')
        self.assertEqual(self.predict(ident)['status'],'disabled');self.assertFalse(self.learn()['active'])
    def test_no_variation_and_mixed_context_rejected(self):
        repeated=[observation(0),observation(10),observation(20)]
        for item in repeated:item['before']['total_received']=0;item['after']['total_received']=5
        self.assertEqual(self.t.learn(repeated,[observation(5)])['status'],'insufficient_variation')
        mixed=[observation(0),observation(10),observation(20)];mixed[-1]['context']['warehouse']='B'
        with self.assertRaises(ValueError):self.t.learn(mixed,[observation(5)])
    def test_rational_coefficient_and_fractional_output_rejected(self):
        def item(x):
            o=observation(x);o['after']['stock']=x//2;return o
        ident=self.t.learn([item(0),item(10),item(20)],[item(6)])['model_id']
        self.assertEqual(self.predict(ident,8)['state']['stock'],4)
        with self.assertRaises(ValueError):self.predict(ident,7)
    def test_constant_transition_not_invertible(self):
        def item(x):
            o=observation(x);o['after']['stock']=7;return o
        ident=self.t.learn([item(0),item(10),item(20)],[item(5)])['model_id']
        self.assertIsNone(self.predict(ident)['inverse_consistent'])
    def test_restart_and_corruption(self):
        with tempfile.TemporaryDirectory() as d:
            e=Engine(database=d+'/db');t=Application(e).transitions
            ident=t.learn([observation(0),observation(10),observation(20)],[observation(5)])['model_id'];e.close()
            e=Engine(database=d+'/db');t=Application(e).transitions
            self.assertEqual(self.predict_with(t,ident)['status'],'predicted')
            e.db.execute("UPDATE contextual_transition_models SET payload='{}'")
            with self.assertRaises(ValueError):self.predict_with(t,ident)
            e.close()
    def predict_with(self,t,ident):
        o=observation(15);return t.predict(ident,o['before'],o['action'],o['context'],o['relationships'])
