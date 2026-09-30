import unittest
import tempfile
from pathlib import Path
from engine import Engine
from app import Application

def image(rgb): return {'width':1,'height':1,'rgb_hex':rgb}
def pair(a,b): return {'before':image(a),'after':image(b)}
def observations(): return {'training':[pair('102030','302010'),pair('405060','605040')],'validation':[pair('708090','908070')]}

class ImageTests(unittest.TestCase):
    def setUp(self): self.engine=Engine(database=':memory:')
    def tearDown(self): self.engine.close()
    def test_auto_learn_and_transform(self):
        app=Application(self.engine)
        learned=app.dispatch({'action':'image_observe','observations':observations()})
        out=app.dispatch({'action':'image_transform','model':learned['model'],'image':{'width':2,'height':1,'rgb_hex':'010203aabbcc'}})
        self.assertEqual(out['image']['rgb_hex'],'030201ccbbaa')
        self.assertEqual(out['bytes_processed'],6)
        self.assertTrue(self.engine.images.observe(observations())['cached'])
    def test_validation_failure_not_stored(self):
        data=observations();data['validation'][0]['after']=image('000000')
        with self.assertRaises(ValueError):self.engine.images.observe(data)
        self.assertEqual(self.engine.db.execute('SELECT COUNT(*) FROM image_programs').fetchone()[0],0)
    def test_reject_overlap(self):
        data=observations();data['validation']=[data['training'][0]]
        with self.assertRaises(ValueError):self.engine.images.observe(data)
    def test_geometry_and_limits(self):
        from image_memory import image_state
        for value in [{'width':True,'height':1,'rgb_hex':'010203'},{'width':2,'height':1,'rgb_hex':'010203'},{'width':4097,'height':1,'rgb_hex':''}]:
            with self.assertRaises(ValueError):image_state(value)
    def test_persistence_and_corruption(self):
        with tempfile.TemporaryDirectory() as folder:
            path=str(Path(folder)/'memory.sqlite3');e=Engine(database=path)
            model=e.images.observe(observations())['model'];e.close();e=Engine(database=path)
            self.assertEqual(e.images.transform(image('abcdef'),model)['image']['rgb_hex'],'efcdab')
            e.db.execute("UPDATE image_programs SET program_hash='broken'")
            with self.assertRaises(ValueError):e.images.transform(image('abcdef'),model)
            e.close()
    def test_overflow_rejects_whole_image(self):
        data={'training':[pair('102030','112030'),pair('405060','415060')],'validation':[pair('708090','718090')]}
        model=self.engine.images.observe(data)['model']
        with self.assertRaises((OverflowError,ValueError)):self.engine.images.transform(image('ff0102'),model)
