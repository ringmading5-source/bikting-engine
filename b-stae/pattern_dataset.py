"""JSONL dataset import and offline evaluation for the connected pattern learner.

Only training rows feed learners. Validation/test rows live in a separate staging
table and are scored without feedback updates. Explicit splits are required.
"""
import argparse
import hashlib
import json
try:
    import resource
except ImportError:
    resource=None
import sys
import time
import tracemalloc
from pathlib import Path
from pattern_memory import encoded
from engine import Engine


def digest(value):return hashlib.sha256(encoded(value).encode()).hexdigest()


class PatternDataset:
    def __init__(self,engine):
        self.engine=engine;self.db=engine.db
        self.db.executescript('''CREATE TABLE IF NOT EXISTS pattern_datasets (
          name TEXT PRIMARY KEY, content_hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS pattern_dataset_records (
          dataset TEXT NOT NULL, id TEXT NOT NULL, episode TEXT NOT NULL,
          split TEXT NOT NULL, fingerprint TEXT NOT NULL, record TEXT NOT NULL,
          PRIMARY KEY(dataset,id));
        CREATE INDEX IF NOT EXISTS pattern_dataset_input ON pattern_dataset_records(fingerprint);
        ''')

    def normalized(self,row):
        if not isinstance(row,dict):raise ValueError('record object required')
        required={'id','episode_id','split','kind','source','context'}
        if not required.issubset(row):raise ValueError('id/episode_id/split/kind/source/context required')
        if any(not isinstance(row[k],str) or not row[k].strip() for k in ('id','episode_id','source')):
            raise ValueError('nonempty IDs and source required')
        if row['split'] not in ('training','validation','test'):raise ValueError('explicit split required')
        encoded(row)
        kind=row['kind']
        if kind=='sequence':
            if set(row)!=required|{'before','after','level'}:raise ValueError('sequence needs before/after/level')
            self.engine.patterns.validate(row['before']);self.engine.patterns.validate(row['after'])
            if not row['before'] or not isinstance(row['level'],str) or not row['level']:raise ValueError('nonempty sequence and level required')
            return {'kind':'sequence','level':row['level'],'context':row['context'],'input':row['before']}
        if kind=='request':
            if set(row)!=required|{'text'} or not isinstance(row['text'],str) or not row['text'].strip() or len(row['text'])>2000:
                raise ValueError('request needs bounded text')
            # Labels are excluded: contradictory labels cannot conceal leakage.
            return {'kind':'request','input':' '.join(row['text'].casefold().split())}
        if kind=='multimodal':
            if set(row)!=required|{'before','after'}:raise ValueError('multimodal needs before/after')
            units,fmt,meta=self.engine.multimodal_patterns.encode(row['before'])
            output,other,outmeta=self.engine.multimodal_patterns.encode(row['after'])
            if fmt!=other or meta!=outmeta or not units:raise ValueError('matching nonempty formats required')
            # Match the sequence learner's representation, detecting leakage
            # between sequence and multimodal records as well.
            return {'kind':'sequence','level':'multimodal:'+fmt['modality'],
                    'context':{'task':row['context'],'format':fmt},'input':units}
        if kind=='raw_text':
            if set(row)!=required|{'text'} or not isinstance(row['text'],str):raise ValueError('raw_text needs text')
            return {'kind':'raw_text','context':row['context'],'input':row['text']}
        raise ValueError('unsupported kind')

    def validate(self,records):
        if not isinstance(records,list) or not 1<=len(records)<=10000:raise ValueError('1..10000 records required')
        ids=set();episodes={};inputs={};normalized=[]
        for index,row in enumerate(records):
            try:
                value=self.normalized(row);fingerprint=digest(value)
                if row['id'] in ids:raise ValueError('duplicate record ID')
                ids.add(row['id'])
                episode=row['episode_id'];split=row['split']
                if episode in episodes and episodes[episode]!=split:raise ValueError('episode crosses splits')
                if fingerprint in inputs and inputs[fingerprint]!=split:raise ValueError('input crosses splits')
                episodes[episode]=split;inputs[fingerprint]=split
                prior=self.db.execute('SELECT split FROM pattern_dataset_records WHERE fingerprint=?',(fingerprint,)).fetchall()
                if any(r['split']!=split for r in prior):raise ValueError('input crosses splits in prior imports')
                # Already learned data must not be labeled held-out afterward.
                if split!='training' and value['kind']=='sequence':
                    if self.db.execute('SELECT 1 FROM pattern_examples WHERE level=? AND context=? AND before_units=?',
                                       (value['level'],encoded(value['context']),encoded(value['input']))).fetchone():
                        raise ValueError('held-out input already exists in learned memory')
                if split!='training' and value['kind']=='request':
                    if any(' '.join(r['text'].casefold().split())==value['input'] for r in self.db.execute('SELECT text FROM pattern_request_examples')):
                        raise ValueError('held-out request already exists in learned memory')
                normalized.append((row,fingerprint))
            except (ValueError,TypeError,KeyError) as error:raise ValueError(f'record {index+1}: {error}') from error
        if not any(r['split']=='training' for r in records):raise ValueError('training split required')
        return normalized

    def load(self,path):
        path=Path(path)
        if path.stat().st_size>16*1024*1024:raise ValueError('dataset exceeds 16 MiB experiment limit')
        rows=[]
        with path.open(encoding='utf-8') as stream:
            for line_number,line in enumerate(stream,1):
                if not line.strip():continue
                try:rows.append(json.loads(line))
                except ValueError as error:raise ValueError(f'line {line_number}: invalid JSON') from error
                if len(rows)>10000:raise ValueError('dataset exceeds 10000 records')
        return rows

    def ingest(self,name,records):
        if not isinstance(name,str) or not name.strip():raise ValueError('dataset name required')
        content_hash=digest(records)
        prior=self.db.execute('SELECT content_hash FROM pattern_datasets WHERE name=?',(name,)).fetchone()
        if prior:
            if prior['content_hash']!=content_hash:raise ValueError('dataset name already belongs to different content')
            return {'status':'already_imported','name':name,'records':len(records)}
        normalized=self.validate(records) # Complete preflight before learner writes.
        groups={};counts={key:0 for key in ('training','validation','test')}
        started=time.perf_counter()
        # Learner methods commit independently; an SQLite backup permits rollback
        # of the entire import if a later learner/discovery step fails.
        import sqlite3
        backup=sqlite3.connect(':memory:');self.db.backup(backup)
        try:
            for row,fingerprint in normalized:
                counts[row['split']]+=1
                if row['split']=='training':
                    kind=row['kind'];context=row['context'];source=row['source']
                    if kind=='sequence':
                        self.engine.patterns.learn_pair(row['before'],row['after'],row['level'],source,context)
                        groups[encoded([row['level'],context])]=(row['level'],context)
                    elif kind=='request':self.engine.request_patterns.learn(row['text'],context,source)
                    elif kind=='raw_text':self.engine.patterns.observe_text(row['text'],source,context)
                    else:
                        learned=self.engine.multimodal_patterns.learn(row['before'],row['after'],context,source)
                        groups[encoded([learned['level'],learned['context']])]=(learned['level'],learned['context'])
                with self.db:
                    self.db.execute('INSERT INTO pattern_dataset_records VALUES (?,?,?,?,?,?)',
                                    (name,row['id'],row['episode_id'],row['split'],fingerprint,encoded(row)))
            searches=[]
            for level,context in groups.values():
                report=self.engine.discovery_patterns.discover(level,context)
                searches.append({'level':level,'context':context,'generated':report['generated'],'search_limited':report['search_limited']})
            with self.db:self.db.execute('INSERT INTO pattern_datasets VALUES (?,?)',(name,content_hash))
        except Exception:
            self.db.rollback();backup.backup(self.db);raise
        finally:backup.close()
        return {'status':'imported','name':name,'split_counts':counts,'searches':searches,
                'seconds':time.perf_counter()-started,'held_out_used_for_learning':False}

    def evaluate(self,name):
        rows=[json.loads(r['record']) for r in self.db.execute('SELECT record FROM pattern_dataset_records WHERE dataset=? ORDER BY id',(name,))]
        if not rows:raise ValueError('unknown dataset')
        self.validate(rows) # Detect held-out contamination introduced after import.
        before=self.db.total_changes;started=time.perf_counter();cases=[]
        for row in rows:
            if row['split']=='training':continue
            kind=row['kind'];preferred=[];all_outputs=[]
            if kind=='raw_text':
                cases.append({'id':row['id'],'split':row['split'],'kind':kind,'scored':False,'reason':'no prediction target'});continue
            if kind=='request':
                result=self.engine.request_patterns.route(row['text']);preferred=[c['context'] for c in result['preferred']];all_outputs=[c['context'] for c in result['candidates']];expected=row['context']
            elif kind=='sequence':
                result=self.engine.pattern_runtime.select(row['before'],row['level'],row['context']);preferred=[c['units'] for c in result['preferred']];all_outputs=[c['units'] for c in result['candidates']];expected=row['after']
            else:
                result=self.engine.multimodal_patterns.predict(row['before'],row['context']);preferred=[c['output'] for c in result['preferred']];all_outputs=[c['output'] for c in result['candidates']];expected=row['after']
            cases.append({'id':row['id'],'split':row['split'],'kind':kind,'scored':True,'status':result['status'],
                          'correct':len(preferred)==1 and encoded(preferred[0])==encoded(expected),
                          'expected_in_candidates':any(encoded(v)==encoded(expected) for v in all_outputs),
                          'preferred_count':len(preferred),'candidate_count':len(all_outputs)})
        if self.db.total_changes!=before:raise RuntimeError('evaluation mutated learned memory')
        summaries={}
        for split in ('validation','test'):
            scored=[c for c in cases if c['split']==split and c['scored']]
            correct=sum(c['correct'] for c in scored)
            summaries[split]={'scored':len(scored),'correct':correct,'accuracy':correct/len(scored) if scored else None}
        return {'dataset':name,'summary':summaries,'cases':cases,'seconds':time.perf_counter()-started,
                'learning_updates':0,'scope':'Exact-output accuracy on supplied targets; no general intelligence claim.'}


def run(path,database,name):
    engine=Engine(database=database);dataset=PatternDataset(engine)
    tracemalloc.start();started=time.perf_counter()
    try:
        records=dataset.load(path);imported=dataset.ingest(name,records);evaluation=dataset.evaluate(name)
        current,peak=tracemalloc.get_traced_memory()
        return {'import':imported,'evaluation':evaluation,'metrics':{
            'elapsed_seconds':time.perf_counter()-started,
            'import_records_per_second':len(records)/imported['seconds'] if imported.get('seconds',0)>0 else None,
            'evaluation_cases_per_second':len(evaluation['cases'])/evaluation['seconds'] if evaluation['seconds']>0 else None,
            'python_traced_peak_bytes':peak,
            'process_peak_rss_bytes':None if resource is None else resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*(1 if sys.platform=='darwin' else 1024),
            'sqlite_allocated_bytes':engine.db.execute('PRAGMA page_count').fetchone()[0]*engine.db.execute('PRAGMA page_size').fetchone()[0],
            'pattern_memory':engine.patterns.stats()},'model_calls':0}
    finally:tracemalloc.stop();engine.close()

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dataset');parser.add_argument('--database',required=True);parser.add_argument('--name',required=True);parser.add_argument('--report')
    args=parser.parse_args();report=run(args.dataset,args.database,args.name);output=json.dumps(report,indent=2)
    if args.report:Path(args.report).write_text(output+'\n',encoding='utf-8')
    print(output)
