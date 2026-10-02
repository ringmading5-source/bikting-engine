"""Separate alignment growth and structured knowledge-volume experiments."""
import json
import statistics
import time
from engine import Engine
from knowledge_question_demo import SUBJECTS,FORMS,FACTS,train_questions


def alignment_run(count,mode):
    e=Engine(database=':memory:')
    try:
        names=list(SUBJECTS[:count])+[f'practice{i}' for i in range(max(0,count-len(SUBJECTS)))]
        start=time.perf_counter()
        result=e.internal_states.learn([{'before':f'what is {s}?','after':f'define {s}','source':'synthetic:alignment'} for s in names],'question',mode)
        training_seconds=time.perf_counter()-start;before=e.db.total_changes;cases=[]
        for topic in ('chemistry','organic chemistry','mathematics'):
            r=e.internal_states.predict(f'what is {topic}?','question',mode)
            cases.append({'question':f'what is {topic}?','status':r['status'],'outputs':[c['text'] for c in r['candidates']],
                          'correct':r['status']=='predicted' and r['candidates'][0]['text']==f'define {topic}'})
        assert before==e.db.total_changes
        return {'examples':count,'mode':mode,'training_status':result['status'],'models':len(result.get('models',[])),
                'training_seconds':training_seconds,'correct':sum(c['correct'] for c in cases),'total':len(cases),'cases':cases,'inference_writes':0}
    finally:e.close()


def knowledge_run(count):
    e=Engine(database=':memory:')
    try:
        assert all(x['status']=='learned' for x in train_questions(e))
        facts=FACTS+[{'subject':f'topic{i:05d}','definition':f'Topic {i:05d} has recorded synthetic property {i}.','source':'synthetic:volume-test'} for i in range(count-len(FACTS))]
        start=time.perf_counter();e.question_knowledge.learn_facts(facts,'knowledge');training=time.perf_counter()-start
        selected=list({f['subject']:f for f in FACTS+[facts[-1]]}.values())
        queries=[(frame.format(subject=f['subject']),f['definition']) for f in selected for _,frame in FORMS]
        before=e.db.total_changes;latencies=[];correct=0
        for repeat in range(5):
            for q,target in queries:
                start=time.perf_counter();r=e.question_knowledge.answer(q,'knowledge');latencies.append((time.perf_counter()-start)*1000)
                if repeat==0:correct+=int(r['status']=='answered' and r['answers'][0]['text']==target)
        assert before==e.db.total_changes
        pages=e.db.execute('PRAGMA page_count').fetchone()[0];page_size=e.db.execute('PRAGMA page_size').fetchone()[0]
        return {'knowledge_records':count,'pattern_training_pairs':len(SUBJECTS)*len(FORMS),'training_seconds':training,
                'correct':correct,'total':len(queries),'timing_repeats':5,'median_answer_ms':statistics.median(latencies),
                'sqlite_allocated_bytes':pages*page_size,'inference_writes':0}
    finally:e.close()

if __name__=='__main__':
    print(json.dumps({'alignment_growth':[alignment_run(n,m) for m in ('character','byte') for n in (3,6,12,24)],
                      'knowledge_growth':[knowledge_run(n) for n in (3,30,300,1200)],'model_calls':0,
                      'limits':['Synthetic small fixed-form request patterns; subjects held out, question forms supplied as paired targets.',
                                'Definitions supplied as structured subject/definition/source records; answers are indexed retrieval, not new-fact discovery.',
                                'Knowledge timing includes request interpretation and retrieval; median of five repeats, one environment.',
                                'SQLite allocated pages include shared representation and model tables; not total process memory.']},indent=2))
