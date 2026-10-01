"""Reproduce the synthetic starter JSONL; scoring oracles stay outside learners."""
import json
from pathlib import Path

def image(values,width=None):
    width=width or len(values)
    return {'image':{'width':width,'height':len(values)//width,'rgb_hex':b''.join(x.to_bytes(3,'big') for x in values).hex()}}
def audio(values):return {'audio':{'samples':values,'sample_rate':16000}}

def build():
    records=[]
    def add(kind,split,context,**payload):
        ident=f'{kind}:{len(records)}'
        records.append(dict(id=ident,episode_id=ident,kind=kind,split=split,context=context,source='synthetic:starter-v1',**payload))
    for context,oracle in [('increment',lambda x:x+1),('scale',lambda x:2*x)]:
        for units in ([1,3,5],[2,4,6,8],[0,7,9,11,13]):
            add('sequence','training',context,before=units,after=[oracle(x) for x in units],level='number')
        for split,offsets in [('validation',range(20,23)),('test',range(40,50))]:
            for offset in offsets:
                units=list(range(offset,offset+6));add('sequence',split,context,before=units,after=[oracle(x) for x in units],level='number')
    for text in ('ab','cde','fghij'):add('multimodal','training','letters',before=text,after=text[::-1])
    for split,texts in [('validation',('klmn','opqrst')),('test',('uvwxyz','ABCDEFG','HIJKLMNO','PQRSTUVWXYZ'))]:
        for text in texts:add('multimodal',split,'letters',before=text,after=text[::-1])
    for values in ([0x010203,0xabcdef],[0x123456,0x678901,0x224466],[1,3,5,7,9]):
        add('multimodal','training','pixels',before=image(values),after=image(values[::-1]))
    for split,offsets in [('validation',(100,200)),('test',(1000,2000,3000,4000))]:
        for offset in offsets:
            units=[offset+i for i in range(6)];add('multimodal',split,'pixels',before=image(units,3),after=image(units[::-1],3))
    for values in ([1,3,5],[-2,4,7,9],[0,2,6,8,11]):
        add('multimodal','training','gain',before=audio(values),after=audio([2*x for x in values]))
    for split,offsets in [('validation',(100,200)),('test',(1000,2000,3000,4000))]:
        for offset in offsets:
            units=[offset+i for i in (-8,2,11,15,-4,0)];add('multimodal',split,'gain',before=audio(units),after=audio([2*x for x in units]))
    for context,texts in [('letters',('reverse letters','reverse word','read backwards')),
                          ('pixels',('reverse pixels','reorder image pixels','flip pixels')),
                          ('gain',('increase audio gain','amplify audio samples','amplify sound'))]:
        for text in texts:add('request','training',context,text=text)
    for split,requests in [('validation',[('letters','reverse these letters'),('pixels','reverse these pixels'),('gain','amplify these audio samples')]),
                           ('test',[('letters','reverse this new word'),('pixels','reorder new image pixels'),('gain','increase the audio gain')])]:
        for context,text in requests:add('request',split,context,text=text)
    add('raw_text','training',None,text='The cat drinks milk.')
    add('raw_text','test',None,text='The dog drinks water.')
    return records

if __name__=='__main__':
    path=Path(__file__).with_name('pattern-starter.jsonl')
    path.write_text('\n'.join(json.dumps(r) for r in build())+'\n',encoding='utf-8')
    print(f'{len(build())} records written')
