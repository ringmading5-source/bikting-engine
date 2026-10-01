"""Explicit English inventory grammar connected to learned numeric behavior."""
import argparse,json,re,unicodedata
from engine import Engine
from coupled_transition_learning import CoupledTransitionLearning
ONES=dict(zip('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(),range(20)))
TENS=dict(zip('twenty thirty forty fifty sixty seventy eighty ninety'.split(),range(20,100,10)))
NUMBER=r'(?:\d{1,19}|(?:'+'|'.join(TENS)+r')(?:[- ](?:'+'|'.join(k for k,v in ONES.items() if 1<=v<=9)+r'))?|(?:'+'|'.join(ONES)+r'))'
PATTERNS=[rf'i have (?P<stock>{NUMBER}) items? and (?:receive|get) (?P<incoming>{NUMBER})(?: more(?: items?)?)?\.(?: how many(?: items)?(?: now| do i have now)\?)?',rf'current stock is (?P<stock>{NUMBER}) and incoming units (?:are|is) (?P<incoming>{NUMBER})\.(?: what is the new stock\?)?']
def number(value):
    parts=value.replace('-',' ').split()
    if value.isdigit():result=int(value)
    elif len(parts)==1 and parts[0] in ONES:result=ONES[parts[0]]
    elif len(parts)==1 and parts[0] in TENS:result=TENS[parts[0]]
    elif len(parts)==2 and parts[0] in TENS and parts[1] in ONES and 1<=ONES[parts[1]]<=9:result=TENS[parts[0]]+ONES[parts[1]]
    else:raise ValueError('unsupported number wording')
    if not 0<=result<2**63:raise ValueError('quantity outside nonnegative int64 range')
    return result

def parse(text):
    if not isinstance(text,str) or not 1<=len(text)<=500 or '\n' in text or ';' in text:return {'status':'unsupported','reason':'One bounded inventory question required.'}
    text=' '.join(unicodedata.normalize('NFKC',text).casefold().split())
    matches=[m for p in PATTERNS if (m:=re.fullmatch(p,text))]
    if len(matches)!=1:return {'status':'unsupported','reason':'Supported: I have 7 items and receive 9 more. How many now?'}
    try:value={k:number(v) for k,v in matches[0].groupdict().items()}
    except ValueError as exc:return {'status':'unsupported','reason':str(exc)}
    return {'status':'parsed','state':value,'action':'receive','context':{'mode':'1'},'relationships':[{'from':'incoming','kind':'adds_to','to':'stock'}]}

def answer(learner,model_id,text):
    request=parse(text)
    if request['status']!='parsed':return dict(request,model_calls=0)
    try:prediction=learner.predict(model_id,request['state'],request['action'],request['context'],request['relationships'])
    except ValueError as exc:return {'status':'unavailable','reason':str(exc),'request':request,'model_calls':0}
    result={'status':prediction['status'],'request':request,'prediction':prediction,'model_calls':0,'language_scope':'explicit English inventory grammar; language understanding was not learned'}
    if prediction['status']=='predicted':result['answer']=f"The learned model predicts {prediction['state']['stock']} items."
    return result

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database',required=True);parser.add_argument('--model-id',required=True);parser.add_argument('question');args=parser.parse_args()
    engine=Engine(database=args.database)
    try:result=answer(CoupledTransitionLearning(engine),args.model_id,args.question)
    finally:engine.close()
    print(json.dumps(result,indent=2));return 0 if result['status']=='predicted' else 1
if __name__=='__main__':raise SystemExit(main())
