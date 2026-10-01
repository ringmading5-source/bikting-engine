"""Held-out synthetic text, RGB and PCM tests with learned request routing."""
import json
from engine import Engine

def image(values,width=None):
    width=width or len(values)
    return {'image':{'width':width,'height':len(values)//width,'rgb_hex':b''.join(x.to_bytes(3,'big') for x in values).hex()}}
def audio(values):return {'audio':{'samples':values,'sample_rate':16000}}

def evaluate():
    engine=Engine(database=':memory:');cases=[]
    try:
        learner=engine.multimodal_patterns;router=engine.request_patterns
        for text in ('ab','cde','fghij'):learner.learn(text,text[::-1],'a','synthetic:text')
        learner.discover('ab','a')
        for request in ('reverse letters','read backwards','reverse word'):router.learn(request,'a','synthetic:request')
        for values in ([0x010203,0xabcdef],[0x123456,0x678901,0x224466],[1,3,5,7,9]):
            learner.learn(image(values),image(values[::-1]),'b','synthetic:image')
        learner.discover(image([1,2]),'b')
        router.learn('reverse pixels','b','synthetic:request');router.learn('reorder image pixels','b','synthetic:request')
        for values in ([1,3,5],[-2,4,7,9],[0,2,6,8,11]):
            learner.learn(audio(values),audio([2*x for x in values]),'c','synthetic:audio')
        learner.discover(audio([1,2]),'c')
        router.learn('increase audio gain','c','synthetic:request');router.learn('amplify audio samples','c','synthetic:request')
        tests=[('reverse these new letters',text,text[::-1]) for text in ('klmnop','QRSTUVW','uvwxyzab')]
        for offset in (10,100,1000):
            values=[offset+x for x in (1,3,5,7,9,11)]
            tests.append(('reverse these new image pixels',image(values,3),image(values[::-1],3)))
            samples=[offset+x for x in (-8,2,11,15,-4,0)]
            tests.append(('amplify these new audio samples',audio(samples),audio([2*x for x in samples])))
        for request,value,expected in tests:
            result=learner.request(request,value);prediction=result.get('prediction',{})
            preferred=prediction.get('preferred',[])
            cases.append({'request':request,'passed':result['routing']['status']=='routed' and len(preferred)==1 and preferred[0]['output']==expected,
                          'routing':result['routing']['status'],'prediction':prediction.get('status')})
        return {'cases':cases,'passed':sum(c['passed'] for c in cases),'total':len(cases),'model_calls':0,
                'scope':'Synthetic lexical routing and signal transformations. No speech, object recognition, or broad semantic understanding.'}
    finally:engine.close()

if __name__=='__main__':print(json.dumps(evaluate(),indent=2))
