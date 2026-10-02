"""Persistent local chatbot using explicit replies and B-STAE claim evidence.

Default greeting replies are supplied interaction policy. No LLM or web calls.
Unknown language is not answered by pretending it is understood.
"""
import json
import re
import secrets
from pattern_memory import encoded

DEFAULTS={'hello':'Hello! How can I help?', 'hi':'Hi! How can I help?', 'hey':'Hey! How can I help?',
          'hello again':'Welcome back! How can I help?',
          'help':'You can greet me, teach me an exact reply, or ask about relationships you have trained. Load the sample lesson to try statements, denials and questions.',
          'what can you do':'I use saved responses and learned sentence patterns to check supplied relationships. I can report missing or conflicting knowledge. I cannot yet answer arbitrary questions.'}

DEFAULTS['what can you do?']=DEFAULTS['what can you do']

class Chatbot:
    def __init__(self,engine):
        self.engine,self.db=engine,engine.db
        self.db.executescript('''CREATE TABLE IF NOT EXISTS chat_replies
            (id INTEGER PRIMARY KEY, text TEXT NOT NULL, reply TEXT NOT NULL, source TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS chat_conversations (id TEXT PRIMARY KEY);
            CREATE TABLE IF NOT EXISTS chat_messages
            (id INTEGER PRIMARY KEY, conversation TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, details TEXT NOT NULL);''')
        if not self.db.execute('SELECT 1 FROM chat_replies WHERE source=? LIMIT 1',('builtin:interaction-policy',)).fetchone():
            with self.db:
                for text,reply in DEFAULTS.items():self.db.execute('INSERT INTO chat_replies(text,reply,source) VALUES (?,?,?)',(text,reply,'builtin:interaction-policy'))

    @staticmethod
    def normalized(text):return ' '.join(text.strip().casefold().rstrip('.!').split())

    def teach(self,text,reply,source):
        for value in (text,reply):
            if not isinstance(value,str) or not value.strip() or len(value)>2000:raise ValueError('1..2000 characters of input and reply required')
            try:value.encode('utf-8')
            except UnicodeEncodeError:raise ValueError('valid Unicode required') from None
        if not isinstance(source,str) or not 1<=len(source)<=256:raise ValueError('source label required')
        with self.db:
            ident=self.db.execute('INSERT INTO chat_replies(text,reply,source) VALUES (?,?,?)',(self.normalized(text),reply,source)).lastrowid
        return {'status':'saved','example':ident,'scope':'exact normalized response association; not general language learning'}

    def conversation(self,ident=None):
        if ident is None:
            ident=secrets.token_hex(16)
            with self.db:self.db.execute('INSERT INTO chat_conversations VALUES (?)',(ident,))
            return ident
        if not isinstance(ident,str) or not re.fullmatch('[0-9a-f]{32}',ident) or not self.db.execute('SELECT 1 FROM chat_conversations WHERE id=?',(ident,)).fetchone():
            raise ValueError('unknown conversation')
        return ident

    def history(self,conversation):
        if conversation is None:raise ValueError('conversation ID required')
        self.conversation(conversation)
        rows=self.db.execute('SELECT role,text,details FROM chat_messages WHERE conversation=? ORDER BY id DESC LIMIT 100',(conversation,)).fetchall()
        return {'conversation':conversation,'messages':[dict(role=r['role'],text=r['text'],details=json.loads(r['details'])) for r in reversed(rows)]}

    def response(self,text,context=None):
        normalized=self.normalized(text)
        rows=self.db.execute('SELECT id,reply,source FROM chat_replies WHERE text=? ORDER BY id',(normalized,)).fetchall()
        replies={r['reply'] for r in rows}
        if len(replies)>1:return {'status':'ambiguous','reply':'I have conflicting saved replies for that input. Please clarify which response is appropriate.', 'source':'saved_replies','evidence':[dict(r) for r in rows],'model_calls':0}
        if replies:return {'status':'answered','reply':next(iter(replies)),'source':'saved_reply','evidence':[dict(r) for r in rows],'model_calls':0}
        from claim_learning import normalize_sentence
        sentence=normalize_sentence(text)
        if len(sentence)>512 or len(sentence.split())>16:
            return {'status':'unknown','reply':'That message is beyond my current learned sentence patterns. Try a short statement or question, or teach me a reply.','source':'knowledge_gap','model_calls':0}
        interpreted=self.engine.coherence.inspect(text,context,context)
        status=interpreted['status'];readings=interpreted.get('readings',[])
        if readings and status in ('answered','supported','conflict'):
            check=readings[0]['coherence']
            if status=='answered':reply=check['answer'].capitalize()+', according to the stored relationship evidence.'
            elif status=='supported':reply='That statement is consistent with the stored relationship evidence.'
            else:reply='That statement conflicts with the stored relationship evidence.'
        elif status in ('ambiguous','contested'):reply='I found competing interpretations or conflicting evidence, so I cannot choose a reliable answer.'
        elif status=='bounded':reply='I reached the current reasoning limit before finding a reliable answer.'
        elif readings:reply='I can identify parts of that sentence, but I do not have the relationship evidence needed to answer it.'
        else:reply='I do not yet have a learned response or sentence pattern for that. You can teach me a reply, or train a relationship pattern.'
        return {'status':status,'reply':reply,'source':'bstae_relationships','interpretation':interpreted,'model_calls':0}

    def send(self,text,conversation=None,context=None):
        if not isinstance(text,str) or not text.strip() or len(text)>512:raise ValueError('1..512 message characters required')
        try:text.encode('utf-8')
        except UnicodeEncodeError:raise ValueError('valid Unicode required') from None
        result=self.response(text,context)
        ident=self.conversation(conversation)
        with self.db:
            for role,message,details in [('user',text,{}),('assistant',result['reply'],result)]:
                self.db.execute('INSERT INTO chat_messages(conversation,role,text,details) VALUES (?,?,?,?)',(ident,role,message,encoded(details)))
        return {**result,'conversation':ident}

    def demo(self):
        context='chat-demo'
        if not self.db.execute('SELECT 1 FROM claim_forms WHERE context=?',(encoded(context),)).fetchone():
            from claim_learning_demo import train
            train(self.engine,context)
            self.engine.coherence.observe({'kind':'capability','subject':'cat','action':'speak','object':'English','allowed':False,'context':context},'synthetic:chat-sample')
        return {'status':'ready','context':context,'scope':'synthetic sample lesson','examples':['cat speaks English.','cat does not speak English.','can cat speak English?']}
