import os
import tempfile
import unittest
from engine import Engine


def image(values,width=None):
    return {'image':{'width':width or len(values),'height':len(values)//(width or len(values)),
                     'rgb_hex':b''.join(x.to_bytes(3,'big') for x in values).hex()}}

def audio(samples,rate=16000):return {'audio':{'samples':samples,'sample_rate':rate}}

class MultimodalTests(unittest.TestCase):
    def setUp(self):self.engine=Engine(database=':memory:')
    def tearDown(self):self.engine.close()
    def test_learned_text_request_unseen_words_and_length(self):
        learner=self.engine.multimodal_patterns;router=self.engine.request_patterns
        for text in ('ab','cde','fghij'):learner.learn(text,text[::-1],'task:a','text:train')
        learner.discover('ab','task:a')
        for text in ('reverse these letters','reverse the word','read backwards'):
            router.learn(text,'task:a','request:train')
        router.learn('repeat the word','task:b','request:train')
        request=learner.request('reverse this new word','klmnop')
        self.assertEqual(request['routing']['status'],'routed')
        self.assertEqual(request['prediction']['preferred'][0]['output'],'ponmlk')
        self.assertFalse(request['prediction']['outcome_verified'])
        self.assertEqual(router.route('astronomical conjectures')['status'],'unknown')
    def test_request_conflicts_preserved(self):
        router=self.engine.request_patterns
        router.learn('reverse letters','a','one');router.learn('reverse letters','b','two')
        result=router.route('reverse letters')
        self.assertEqual(result['status'],'ambiguous')
        self.assertEqual(len(result['preferred']),2)
        self.assertEqual(self.engine.db.execute('SELECT count(*) FROM pattern_request_examples').fetchone()[0],2)
    def test_image_pixels_preserve_channels_and_unseen_dimensions(self):
        learner=self.engine.multimodal_patterns
        for values in ([0x010203,0xabcdef],[0x123456,0x678901,0x224466],[1,3,5,7,9]):
            learner.learn(image(values),image(values[::-1]),'pixels','image:train')
        learner.discover(image([1,2]),'pixels')
        values=[0x112233,0x445566,0x778899,0xaabbcc,0xddeeff,0x123456]
        prediction=learner.predict(image(values,width=3),'pixels')
        self.assertEqual(prediction['preferred'][0]['output'],image(values[::-1],width=3))
    def test_audio_gain_from_samples_and_rate_rejection(self):
        learner=self.engine.multimodal_patterns
        for samples in ([1,3,5],[-2,4,7,9],[0,2,6,8,11]):
            learner.learn(audio(samples),audio([2*x for x in samples]),'gain','audio:train')
        learner.discover(audio([1,2]),'gain')
        samples=[-100,200,500,-300,600,0]
        result=learner.predict(audio(samples),'gain')
        self.assertEqual(result['preferred'][0]['output'],audio([2*x for x in samples]))
        self.assertEqual(learner.predict(audio(samples,8000),'gain')['status'],'unknown')
        invalid=learner.predict(audio([20000,21000,22000]),'gain')
        self.assertEqual(invalid['status'],'unsupported_output')
        self.assertTrue(invalid['rejected'])
    def test_format_validation(self):
        learner=self.engine.multimodal_patterns
        for value in (image([1,2]),audio([1,2])):
            with self.assertRaises(ValueError):learner.learn('ab',value,'a','source')
        with self.assertRaises(ValueError):learner.encode(audio([40000]))
        with self.assertRaises(ValueError):learner.encode({'image':{'width':2,'height':1,'rgb_hex':'ff'}})
    def test_restart_and_api(self):
        from app import Application
        with tempfile.TemporaryDirectory() as folder:
            path=os.path.join(folder,'memory.db');first=Engine(database=path);app=Application(first)
            for text in ('ab','cde','fghij'):
                app.dispatch({'action':'multimodal_pattern_learn','before':text,'after':text[::-1],'context':'a','source':'train'})
            app.dispatch({'action':'multimodal_pattern_discover','value':'ab','context':'a'})
            app.dispatch({'action':'request_pattern_learn','text':'reverse characters','context':'a','source':'request'})
            first.close();second=Engine(database=path)
            try:
                app=Application(second)
                result=app.dispatch({'action':'multimodal_pattern_request','text':'reverse new characters','value':'zyxwvu'})
                self.assertEqual(result['prediction']['preferred'][0]['output'],'uvwxyz')
            finally:second.close()
