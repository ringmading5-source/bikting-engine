import json
from engine import Engine

def evaluate():
    e=Engine(database=':memory:')
    try:
        first=e.numeric_text.encode('three cats');second=e.numeric_text.encode('two rabbits')
        unseen=e.numeric_text.encode('three rabbits');unicode=e.numeric_text.encode('  Café 🐇!\n')
        before=e.db.total_changes
        decoded=e.numeric_text.decode(unseen['sentence_id'])
        unicode_decoded=e.numeric_text.decode(unicode['sentence_id'])
        assert before==e.db.total_changes
        return {'known':[first,second],'unseen':unseen,'decoded':decoded,
                'reused_word_ids':unseen['word_ids']==[first['word_ids'][0],second['word_ids'][1]],
                'unicode_roundtrip':unicode_decoded['text']=='  Café 🐇!\n','decode_writes':0,
                'scope':'Lossless numeric representation; token boundaries supplied; no new semantic learning. IDs stable within one database.'}
    finally:e.close()
if __name__=='__main__':print(json.dumps(evaluate(),indent=2,ensure_ascii=False))
