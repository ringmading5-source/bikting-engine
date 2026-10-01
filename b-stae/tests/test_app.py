import unittest
from app import Application
from engine import Engine
class AppTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:');self.a=Application(self.e)
    def tearDown(self):self.e.close()
    def test_removed_inference_routes(self):
        for action in ('vector_train','vector_predict','vector_plan','vector_verify','vector_model','learn','predict','examples','image_observe','image_transform','modality_observe','sequence_example','sequence_learn','behavior_predict'):
            with self.subTest(action=action),self.assertRaises(ValueError):self.a.dispatch({'action':action})
    def test_explicit_procedure_storage_and_execution(self):
        stored=self.a.dispatch({'action':'modality_register','value':3,'intent':'add 2','source':'runbook:add'})
        self.assertEqual(stored['status'],'registered')
        self.assertEqual(self.a.dispatch({'action':'modality_transform','value':100,'program':stored['program']})['decoded'],102)
    def test_engine_has_no_training_subsystems(self):
        for name in ('vector_model','learner','sequences','images'):self.assertFalse(hasattr(self.e,name))
    def test_old_inferred_relationship_is_not_executable(self):
        from byte_relationships import Relationship,Guard,Effect,Fragment
        from core import INT64
        rule=Relationship(900,(Guard(1,INT64,length=8),),(Effect(1,INT64,(Fragment(1,0,8,delta=2,signed=True),)),))
        self.e.relationships.register(rule)
        self.e.db.execute('CREATE TABLE learned_relationships (relationship_id INTEGER PRIMARY KEY)')
        self.e.db.execute('INSERT INTO learned_relationships VALUES (900)')
        self.assertNotIn(900,self.e.relationships.load())
        self.assertEqual(self.e.db.execute('SELECT COUNT(*) FROM byte_relationships WHERE id=900').fetchone()[0],1)
        result=self.e.interact({1:3},{1:5})
        self.assertFalse(result.accepted)
