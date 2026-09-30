import json
import unittest
from engine import Engine
from knowledge import parse_source

class SequenceTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:')
    def tearDown(self):self.e.close()
    def seq(self,values,event=None):return {'frames':[{'time':i,'entities':{'1':v}} for i,v in enumerate(values)],'events':[event or {'name':'step'} for _ in range(len(values)-1)]}
    def source(self,training,validation):
        data={'training_sequences':training,'validation_sequences':validation}
        sid=self.e.knowledge.ingest(parse_source(json.dumps(data),'application/json','sequence-fixture'));self.e.encode_source(sid);return sid
    def test_position_behavior_and_event(self):
        p=lambda n:{'position':[n,0,0]}
        sid=self.source([self.seq([p(0),p(2),p(4)])],[self.seq([p(20),p(22)])])
        report=self.e.sequences.learn_source(sid,500)
        self.assertIn('word-delta',report['hypotheses']);self.assertEqual(report['training_transitions'],2)
        result=self.e.sequences.predict({'25':p(100)},{'name':'step','duration':1})
        self.assertEqual(result['decoded'][25],[102,0,0]);self.assertTrue(result['changes'])
        self.assertEqual(self.e.sequences.predict({'25':p(100)},{'name':'step','duration':2})['status'],'unknown')
    def test_text_sequence(self):
        sid=self.source([self.seq(['Hi','Hi!','Hi!!'])],[self.seq(['New','New!'])])
        report=self.e.sequences.learn_source(sid,501)
        result=self.e.sequences.predict({'30':'Other'},{'name':'step','duration':1})
        self.assertEqual(result['decoded'][30],'Other!')
        self.assertEqual(report['transitions'][0]['changes'][0]['changed_after_hex'],'21')
    def test_color_sequence(self):
        sid=self.source([self.seq(['#010203','#030201','#010203'])],[self.seq(['#040506','#060504'])])
        self.e.sequences.learn_source(sid,502)
        self.assertEqual(self.e.sequences.predict({'40':'#102030'},{'name':'step','duration':1})['decoded'][40]['hex'],'#302010')
    def test_audio_sequence(self):
        audio=lambda samples:{'audio':{'samples':samples,'sample_rate':8000}}
        event={'name':'reverse','sample_rate':8000}
        sid=self.source([self.seq([audio([10,20]),audio([20,10]),audio([10,20])],event)],
                        [self.seq([audio([30,40]),audio([40,30])],event)])
        self.e.sequences.learn_source(sid,503)
        result=self.e.sequences.predict({'50':audio([70,80])},{'name':'reverse','sample_rate':8000,'duration':1})
        self.assertEqual(result['decoded'][50],[80,70])
    def test_heldout_failure_not_promoted(self):
        sid=self.source([self.seq(['Hi','Hi!','Hi!!'])],[self.seq(['New','New?'])])
        with self.assertRaises(ValueError):self.e.sequences.learn_source(sid,1)
        self.assertFalse(self.e.relationships.load())
    def test_temporal_order_and_missing_events(self):
        s=self.seq(['A','A!']);s['frames'][1]['time']=0
        with self.assertRaises(ValueError):self.e.sequences.pairs([s])
        s=self.seq(['A','A!']);s['events']=[]
        with self.assertRaises(ValueError):self.e.sequences.pairs([s])
    def test_context_changes_and_entity_drift_rejected(self):
        s=self.seq(['A','A!','A!!']);s['events'][1]={'name':'other'}
        with self.assertRaises(ValueError):self.e.sequences.pairs([s])
        s=self.seq(['A','A!']);s['frames'][1]['entities']={'2':'A!'}
        with self.assertRaises(ValueError):self.e.sequences.pairs([s])
    def test_serialization_of_learned_word_delta(self):
        p=lambda n:{'position':[n,0,0]}
        sid=self.source([self.seq([p(0),p(2),p(4)])],[self.seq([p(20),p(22)])]);self.e.sequences.learn_source(sid,1)
        self.assertEqual(self.e.relationships.load()[1].id,1)
    def test_event_duration_mismatch(self):
        with self.assertRaises(ValueError):self.e.sequences.pairs([self.seq(['A','A!'],{'name':'step','duration':2})])

if __name__=='__main__':unittest.main()

class SequenceAppTests(unittest.TestCase):
    def test_demo_prediction_via_app(self):
        from app import Application
        e=Engine(database=':memory:');app=Application(e)
        try:
            self.assertEqual(app.dispatch({'action':'sequence_example'})['status'],'validated_on_sequences')
            result=app.dispatch({'action':'behavior_predict','inputs':'{"25":{"position":[100,0,0]}}','event':{'name':'advance','duration':1}})
            self.assertEqual(result['decoded'][25],[102,0,0])
            self.assertEqual(app.dispatch({'action':'sequence_example'})['relationship_id'],600)
        finally:e.close()
    def test_sequence_model_persists(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            db=str(Path(d)/'memory.db');e=Engine(database=db)
            sid=e.ingest_file(Path(__file__).resolve().parents[1]/'examples'/'position-sequences.json');e.sequences.learn_source(sid,600);e.close()
            e=Engine(database=db)
            try:self.assertEqual(e.sequences.predict({'25':{'position':[100,0,0]}},{'name':'advance','duration':1})['decoded'][25],[102,0,0])
            finally:e.close()
