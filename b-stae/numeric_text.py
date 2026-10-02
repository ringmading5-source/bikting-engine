"""Lossless numeric text hierarchy. IDs identify symbols; they are not quantities."""
import json
import re
from pattern_memory import encoded


class NumericText:
    def __init__(self,engine):
        self.db=engine.db
        self.db.executescript('''CREATE TABLE IF NOT EXISTS numeric_characters
          (codepoint INTEGER PRIMARY KEY, bytes TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS numeric_tokens
          (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, characters TEXT NOT NULL,
           UNIQUE(kind,characters));
          CREATE TABLE IF NOT EXISTS numeric_sentences
          (id INTEGER PRIMARY KEY, tokens TEXT NOT NULL UNIQUE);''')

    def encode(self,text):
        if not isinstance(text,str) or not text or len(text)>4096:raise ValueError('1..4096 characters required')
        try:raw=list(text.encode('utf-8'))
        except UnicodeEncodeError:raise ValueError('valid Unicode text required') from None
        parts=re.findall(r'\w+|\s+|[^\w\s]+',text)
        if len(parts)>512:raise ValueError('up to 512 tokens required')
        token_ids=[];words=[];links=[]
        with self.db:
            for char in dict.fromkeys(text):
                self.db.execute('INSERT OR IGNORE INTO numeric_characters VALUES (?,?)',(ord(char),encoded(list(char.encode('utf-8')))))
            for part in parts:
                kind='space' if part.isspace() else 'word' if re.fullmatch(r'\w+',part) else 'punctuation'
                numbers=[ord(c) for c in part]
                self.db.execute('INSERT OR IGNORE INTO numeric_tokens(kind,characters) VALUES (?,?)',(kind,encoded(numbers)))
                ident=self.db.execute('SELECT id FROM numeric_tokens WHERE kind=? AND characters=?',(kind,encoded(numbers))).fetchone()[0]
                token_ids.append(ident)
                if kind=='word':words.append(ident)
                links.append({'token_id':ident,'kind':kind,'character_numbers':numbers,'byte_numbers':list(part.encode('utf-8'))})
            self.db.execute('INSERT OR IGNORE INTO numeric_sentences(tokens) VALUES (?)',(encoded(token_ids),))
            sentence=self.db.execute('SELECT id FROM numeric_sentences WHERE tokens=?',(encoded(token_ids),)).fetchone()[0]
        return {'sentence_id':sentence,'token_ids':token_ids,'word_ids':words,'character_numbers':[ord(c) for c in text],
                'byte_numbers':raw,'links':links,'id_scope':'This database; IDs are categorical identifiers, not quantities.',
                'boundaries':'Supplied Unicode word/space/punctuation tokenization; the entire input is one sentence unit.'}

    def decode_tokens(self,ids):
        if not isinstance(ids,list) or not 1<=len(ids)<=512 or any(type(i) is not int or i<1 for i in ids):
            raise ValueError('1..512 positive token IDs required')
        output=[];total=0
        for ident in ids:
            row=self.db.execute('SELECT characters FROM numeric_tokens WHERE id=?',(ident,)).fetchone()
            if row is None:raise ValueError('unknown token ID')
            numbers=json.loads(row[0])
            for number in numbers:
                char=self.db.execute('SELECT bytes FROM numeric_characters WHERE codepoint=?',(number,)).fetchone()
                if char is None:raise ValueError('missing character link')
                try:decoded=bytes(json.loads(char[0])).decode('utf-8')
                except (ValueError,UnicodeDecodeError,TypeError):raise ValueError('invalid character byte link') from None
                if len(decoded)!=1 or ord(decoded)!=number:raise ValueError('inconsistent character byte link')
                output.append(decoded);total+=1
                if total>4096:raise ValueError('decoded character budget exceeded')
        return ''.join(output)

    def decode(self,sentence_id):
        if type(sentence_id) is not int or sentence_id<1:raise ValueError('positive sentence ID required')
        row=self.db.execute('SELECT tokens FROM numeric_sentences WHERE id=?',(sentence_id,)).fetchone()
        if row is None:raise ValueError('unknown sentence ID')
        return {'sentence_id':sentence_id,'text':self.decode_tokens(json.loads(row[0]))}
