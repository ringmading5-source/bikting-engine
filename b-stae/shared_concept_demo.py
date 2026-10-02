"""Synthetic color/tone linkage; tones are arbitrary labels, not spoken words."""
import math
import json
from engine import Engine

CONCEPTS=[('red',0,300),('green',1,600),('blue',2,900)]

def image(channel,brightness,size=4):
    pixel=[10,10,10];pixel[channel]=brightness
    return {'image':{'width':size,'height':size,'rgb_hex':(bytes(pixel)*(size*size)).hex()}}

def audio(frequency,amplitude=8000,phase=0,length=320):
    return {'audio':{'sample_rate':8000,'samples':[round(amplitude*math.sin(2*math.pi*frequency*i/8000+phase)) for i in range(length)]}}

def train(engine):
    learner=engine.shared_concepts
    for label,channel,frequency in CONCEPTS:
        for index,word in enumerate(('patch','tile','square')):
            learner.observe(label,f'{label} {word}','synthetic:color-text')
            learner.observe(label,image(channel,230+10*index),'synthetic:RGB-patch')
            learner.observe(label,audio(frequency,6000+1000*index,phase=index*.3),'synthetic:arbitrary-tone')

def run():
    e=Engine(database=':memory:')
    try:
        train(e);before=e.db.total_changes;cases=[]
        for label,channel,frequency in CONCEPTS:
            values=[f'{label} surface',image(channel,235,size=5),audio(frequency,9500,.8,length=400)]
            result=e.shared_concepts.inspect(values)
            cases.append({'expected':label,'result':result,'correct':result['status']=='aligned' and result['concept']==label})
        unknown=e.shared_concepts.predict('unfamiliar creature')
        mismatch=e.shared_concepts.inspect(['red surface',image(2,235)])
        return {'correct':sum(c['correct'] for c in cases),'total':len(cases),'unseen_inputs':9,
                'cases':cases,'unknown':unknown,'mismatch':mismatch,'inference_writes':e.db.total_changes-before,
                'scope':'Synthetic color patches and assigned pure tones; no cat recognition, human speech, or general language test.'}
    finally:e.close()

if __name__=='__main__':print(json.dumps(run(),indent=2))
