"""Optional bounded Gemini intent interpreter; execution stays in B-STAE."""
import json
import os
import re
import urllib.request
import urllib.error
from recognition import recognize

class GeminiAdapter:
    def __init__(self, engine, transport=None):
        self.engine = engine
        self.transport = transport or self._send

    def status(self):
        return {'configured': bool(os.environ.get('GEMINI_API_KEY')), 'model': os.environ.get('GEMINI_MODEL', 'gemini-2.5-flash')}

    def _send(self, model, key, body):
        request = urllib.request.Request('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent', data=json.dumps(body).encode(), headers={'Content-Type':'application/json', 'x-goog-api-key':key})
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                raw=response.read(65537)
                if len(raw)>65536: raise ValueError('Gemini response exceeds limit')
                return json.loads(raw)
        except urllib.error.HTTPError as error:
            raise ValueError('Gemini request failed (HTTP %s)' % error.code) from None
        except (urllib.error.URLError, TimeoutError):
            raise ValueError('Gemini connection failed or timed out') from None

    def interpret(self, text, value):
        if not isinstance(text,str) or not 1<=len(text)<=2000: raise ValueError('request text requires 1..2000 characters')
        # Known syntax executes through local parser, avoiding a model call.
        try:
            intent=self.engine.intents.parse(text)
            self.engine.intents.boundary(self.engine.modalities.recognize(value)[0].state,intent)
            return {'status':'proposed','intent':intent,'source':'local_parser','model_calls':0}
        except (ValueError, KeyError): pass
        recognized=recognize(value)
        context={'representation':recognized.representation,'metadata':recognized.metadata}
        if recognized.representation not in ('int64','utf8','rgb24','pcm16','position3'): raise ValueError('unsupported Gemini input representation')
        key=os.environ.get('GEMINI_API_KEY','')
        if not key: return {'status':'not_configured','reason':'Set GEMINI_API_KEY in the Python service environment','model_calls':0}
        model=os.environ.get('GEMINI_MODEL','gemini-2.5-flash')
        if not re.fullmatch(r'[A-Za-z0-9._-]{1,100}',model): raise ValueError('invalid Gemini model')
        schema={'type':'OBJECT','properties':{'intent_text':{'type':'STRING'},'reason':{'type':'STRING'}},'required':['intent_text','reason']}
        body={'systemInstruction':{'parts':[{'text':'Translate the request into ONE supported B-STAE operation applicable to the provided representation. Return intent_text using exactly one grammar: add N; append "text"; brighten N; move by X,Y,Z; shift samples by N. N and coordinates must be integers. If ambiguous, unsupported or requiring external actions, return an empty intent_text with a brief reason. Never invent tools or claim execution.'}]},'contents':[{'role':'user','parts':[{'text':json.dumps({'request':text,'context':context},ensure_ascii=False)}]}], 'generationConfig':{'temperature':0,'maxOutputTokens':512,'thinkingConfig':{'thinkingBudget':0},'responseMimeType':'application/json','responseSchema':schema}}
        response=self.transport(model,key,body)
        try:
            candidate=response['candidates'][0]
            if candidate.get('finishReason')!='STOP': raise ValueError()
            result=json.loads(''.join(p.get('text','') for p in candidate['content']['parts'] if not p.get('thought')))
            if not isinstance(result,dict) or set(result)!={'intent_text','reason'} or not all(isinstance(v,str) and len(v)<=4096 for v in result.values()): raise ValueError()
        except (KeyError, IndexError, TypeError, ValueError): raise ValueError('Gemini returned an invalid or incomplete intent proposal') from None
        if not result['intent_text']: return {'status':'needs_clarification','reason':result['reason'],'model_calls':1}
        intent=self.engine.intents.parse(result['intent_text'])
        self.engine.intents.boundary(recognized.state,intent)
        return {'status':'proposed','intent':intent,'reason':result['reason'],'source':'gemini','model':model,'model_calls':1}

    def execute(self,text,value):
        proposal=self.interpret(text,value)
        if proposal['status']!='proposed': return proposal
        result=self.engine.intents.execute(value,proposal['intent'])
        return dict(result, interpretation=proposal, verification_scope='declared byte transformation; user intent interpretation is model proposed')
