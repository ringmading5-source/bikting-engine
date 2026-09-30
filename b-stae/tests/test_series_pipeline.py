import unittest
import tempfile
from pathlib import Path
from engine import Engine
from app import Application
from capabilities import Capability
class PipelineTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:')
    def tearDown(self):self.e.close()
    def test_request_to_verified_chain(self):
        result=Application(self.e).dispatch({'action':'word_execute','text':'add 2 to every value then graph the result','value':[2,5,3]})
        self.assertEqual(result['final_values'],[4,7,5]);self.assertTrue(result['stabilized']);self.assertTrue(result['verified'])
        self.assertEqual([step['capability'] for step in result['execution_trace']],['binary.series_add','matplotlib.numeric_plot'])
        self.assertEqual(result['coordinates'],[{'x':0,'y':4.0},{'x':1,'y':7.0},{'x':2,'y':5.0}])
        self.assertEqual(result['execution_trace'][0]['result']['operand_hex'],'0000000000000040')
        self.assertEqual(result['execution_trace'][0]['target_hex'],result['execution_trace'][1]['entry_hex'])
    def test_multiple_and_decimal_additions(self):
        result=self.e.words.execute('add -2 to every value then add 0.5 to every value then bar chart',[2,5,3])
        self.assertEqual(result['final_values'],[.5,3.5,1.5]);self.assertEqual(len(result['execution_trace']),3)
    def test_cache_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            path=str(Path(folder)/'memory.sqlite3');e=Engine(database=path);text='add 2 to every value then graph result'
            e.words.execute(text,[2,5,3]);e.close();e=Engine(database=path)
            self.assertEqual(e.words.execute(text,[2,5,3])['resolution'],'reverified_pipeline_memory');e.close()
    def test_overflow_preflight_no_promotion(self):
        result=self.e.words.execute('add 2 to every value then graph result',[1e12]);self.assertEqual(result['status'],'incoherent')
        self.assertEqual(self.e.db.execute('SELECT COUNT(*) FROM series_pipeline_memory').fetchone()[0],0)
    def test_bad_transform_never_promoted(self):
        cap=self.e.capabilities.registry['binary.series_add']
        self.e.capabilities.registry[cap.id]=Capability(cap.id,cap.input_type,cap.output_type,cap.effect,cap.styles,cap.version,lambda spec,values:{'state_hex':'wrong','values':values})
        with self.assertRaises(ValueError):self.e.words.execute('add 2 to every value then graph result',[2,5,3])
        self.assertEqual(self.e.db.execute('SELECT COUNT(*) FROM series_pipeline_memory').fetchone()[0],0)
    def test_incompatible_order_and_ambiguity(self):
        plot={'operation':'plot_values','style':'line'}
        with self.assertRaises(ValueError):self.e.series_plans.preflight([plot,plot],[1,2])
        cap=self.e.capabilities.registry['binary.series_add'];self.e.capabilities.register(Capability('second.add',cap.input_type,cap.output_type,cap.effect,cap.styles,cap.version,cap.execute))
        self.assertEqual(self.e.words.resolve('add 2 to every value then graph result',[1,2])['status'],'incoherent')
    def test_unrecognized_phrase_is_not_guessed(self):
        self.assertEqual(self.e.words.execute('change these numbers somehow then graph result',[2,5,3])['status'],'unknown')
