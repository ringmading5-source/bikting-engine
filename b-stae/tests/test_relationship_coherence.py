import tempfile
import unittest
from engine import Engine
from app import Application

def membership(subject, group, context=None):
    return {'kind':'membership','subject':subject,'class':group,'context':context}

def capability(subject, allowed, context=None, action='speak', obj='English'):
    return {'kind':'capability','subject':subject,'action':action,'object':obj,'allowed':allowed,'context':context}

class CoherenceTests(unittest.TestCase):
    def setUp(self):
        self.e=Engine(database=':memory:');self.c=self.e.coherence
        self.record={'actor':'cat','action':'speak','object':'English'}
        self.c.observe(membership('cat','ordinary_cat'),'synthetic:taxonomy')
        self.c.observe(membership('ordinary_cat','animal'),'synthetic:taxonomy')
        self.negative=self.c.observe(capability('ordinary_cat',False),'synthetic:default')['id']
    def tearDown(self):self.e.close()
    def test_inherited_conflict_and_missing(self):
        before=self.e.db.total_changes;r=self.c.check(self.record)
        self.assertEqual(r['status'],'conflict')
        self.assertEqual(r['suggested_assertion'],capability('cat',False))
        self.assertEqual(len(r['deciding_evidence'][0]['membership_path']),1)
        self.assertEqual(self.c.check(dict(self.record,actor='robot'))['status'],'unknown')
        self.assertEqual(self.c.check(dict(self.record,object='Dinka'))['status'],'unknown')
        self.assertEqual(before,self.e.db.total_changes)
    def test_contextual_exception_and_isolation(self):
        self.c.observe(capability('cat',True,'fiction'),'synthetic:story')
        self.assertEqual(self.c.check(self.record,'fiction')['status'],'supported')
        self.assertEqual(self.c.check(self.record,'real')['status'],'conflict')
        self.assertEqual(self.c.check(self.record)['status'],'conflict')
    def test_specificity_and_equal_conflict(self):
        self.c.observe(capability('animal',True),'synthetic:broad')
        self.assertEqual(self.c.check(self.record)['status'],'conflict')
        self.c.observe(capability('ordinary_cat',True),'synthetic:counterevidence')
        self.assertEqual(self.c.check(self.record)['status'],'contested')
        self.c.observe(capability('cat',True),'synthetic:individual')
        self.assertEqual(self.c.check(self.record)['status'],'supported')
    def test_revisions_preserve_history(self):
        r=self.c.observe(capability('ordinary_cat',True),'synthetic:revision',self.negative)
        self.assertEqual(self.c.check(self.record)['status'],'supported')
        self.assertEqual(self.e.db.execute('SELECT count(*) FROM coherence_evidence').fetchone()[0],4)
        with self.assertRaises(ValueError):self.c.observe(capability('cat',False),'bad',r['id'])
        with self.assertRaises(ValueError):self.c.observe(capability('ordinary_cat',False),'bad',self.negative)
    def test_cycle_transitive(self):
        self.c.observe(membership('animal','cat'),'synthetic:cycle')
        self.c.observe(capability('animal',True,action='eat',obj='*'),'synthetic:broad')
        r=self.c.check(dict(self.record,action='eat',object='food'))
        self.assertEqual(r['status'],'supported')
        self.assertEqual(len(r['deciding_evidence'][0]['membership_path']),2)
    def test_role_prediction_then_check(self):
        pairs=[{'text':f'{a} {v}s {o}','record':{'actor':a,'action':v,'object':o}}
               for a,v,o in [('dog','push','box'),('bird','lift','cart'),('robot','kick','ball')]]
        self.e.roles.learn(pairs,'roles')
        r=Application(self.e).dispatch({'action':'coherence_inspect','text':'cat speaks English','role_context':'roles'})
        self.assertEqual(r['role_status'],'predicted');self.assertEqual(r['status'],'conflict')
        self.assertEqual(r['readings'][0]['record'],self.record)
        self.assertFalse(r['automatic_rewrite'])
        self.assertEqual(self.c.inspect('the cat speaks English','roles')['status'],'unknown')
    def test_validation(self):
        for a in [capability('cat',1),membership('cat','animal',{}),{'kind':'other'}]:
            with self.assertRaises(ValueError):self.c.observe(a,'test')
        with self.assertRaises(ValueError):self.c.observe(capability('cat',True),'')
    def test_bounds(self):
        for i in range(128):self.c.observe(membership('cat',f'class{i}'),'synthetic')
        self.assertEqual(self.c.check(self.record)['status'],'bounded')
    def test_restart(self):
        with tempfile.TemporaryDirectory() as d:
            e=Engine(database=d+'/db')
            Application(e).dispatch({'action':'coherence_observe','assertion':capability('cat',False),'source':'synthetic'})
            e.close();e=Engine(database=d+'/db')
            try:self.assertEqual(e.coherence.check(self.record)['status'],'conflict')
            finally:e.close()
