import json
from engine import Engine

TEXTS=['The cat carries books.','The dog carries tools.','The farmer carries seeds.','The child carries papers.','The robot carries boxes.']

def evaluate():
    e=Engine(database=':memory:')
    try:
        runs=[]
        for mode in ('character','byte'):
            learned=e.recursive_patterns.learn([{'text':t,'source':'synthetic:raw'} for t in TEXTS],'raw-carry',mode,rounds=32)
            inventory=e.recursive_patterns.inventory('raw-carry',mode);before=e.db.total_changes
            unseen='The traveller carries maps.'
            packet=e.recursive_patterns.encode(unseen,'raw-carry',mode)
            novel=e.recursive_patterns.encode('A café carries 🐇.','raw-carry',mode)
            assert before==e.db.total_changes
            runs.append({'learned':learned,'inventory':inventory,'unseen':packet,'decoded':e.recursive_patterns.decode(packet['units'],mode),
                         'novel_unicode':novel,'prediction_learning_updates':0})
        return {'training_raw_text':TEXTS,'runs':runs,'model_calls':0,
                'scope':'Recursive symbolic frequent-pair discovery. New composites can contain earlier learned units; no semantic roles, meanings or actions learned.'}
    finally:e.close()
if __name__=='__main__':print(json.dumps(evaluate(),indent=2,ensure_ascii=False))
