import unittest
import tempfile
from pathlib import Path
from engine import Engine
from app import Application
from capabilities import Capability
class CapabilityTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:')
    def tearDown(self):self.e.close()
    def test_line_exact_coordinates_and_memory(self):
        result=self.e.capabilities.execute('graph these values',[2,5,3])
        self.assertEqual(result['coordinates'],[{'x':0,'y':2.0},{'x':1,'y':5.0},{'x':2,'y':3.0}]);self.assertTrue(result['verified']);self.assertIn('<svg',result['svg'])
        second=self.e.capabilities.execute('graph these values',[2,5,3]);self.assertEqual(second['resolution'],'reverified_memory');self.assertEqual(second['svg'],result['svg'])
    def test_recursive_plot_terminal(self):
        result=self.e.words.execute('graph these values',[2,5,3]);self.assertEqual(result['status'],'fulfilled');self.assertTrue(result['stabilized'])
        self.assertEqual(result['actions'],[{'operation':'plot_values','style':'line'}]);self.assertGreater(result['rounds'],1)
    def test_bar_and_float_input(self):
        result=self.e.words.execute('bar chart',[1.5,-2,0]);self.assertEqual(result['requirements']['style'],'bar');self.assertEqual(len(result['coordinates']),3)
    def test_reject_and_underspecified(self):
        for value in [[],[True],[float('nan')],[float('inf')],[10**20],list(range(257)),['3']]:
            with self.assertRaises(ValueError):self.e.capabilities.execute('line graph',value)
        self.assertEqual(self.e.capabilities.execute('graph',[1,2])['status'],'needs_details')
        self.assertEqual(self.e.words.resolve('graph these values','text')['status'],'incoherent')
    def test_registry_properties_and_ambiguity(self):
        registry=self.e.capabilities
        first=next(iter(registry.registry.values()))
        with self.assertRaises(ValueError):registry.register(first)
        registry.register(Capability('other.plot','numeric_series','svg','plot_values',('line',),'1',first.execute))
        with self.assertRaisesRegex(ValueError,'ambiguous'):registry.execute('line graph',[1,2])
    def test_changed_data_different_boundary(self):
        self.e.capabilities.execute('line graph',[1,2]);self.e.capabilities.execute('line graph',[1,3])
        self.assertEqual(self.e.db.execute('SELECT COUNT(*) FROM capability_paths').fetchone()[0],2)
    def test_app_and_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            path=str(Path(folder)/'memory.sqlite3');e=Engine(database=path)
            result=Application(e).dispatch({'action':'word_execute','text':'line graph','value':[2,5,3]});self.assertTrue(result['verified']);e.close()
            e=Engine(database=path);self.assertEqual(e.words.execute('line graph',[2,5,3])['resolution'],'reverified_memory');e.close()
    def test_bad_artists_not_promoted(self):
        self.e.capabilities.verify_artists=lambda *args:(_ for _ in ()).throw(ValueError('coordinate mismatch'))
        with self.assertRaises(ValueError):self.e.capabilities.execute('line graph',[1,2])
        self.assertEqual(self.e.db.execute('SELECT COUNT(*) FROM capability_paths').fetchone()[0],0)
