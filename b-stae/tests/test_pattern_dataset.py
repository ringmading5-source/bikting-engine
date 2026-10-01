import copy
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
from engine import Engine
from pattern_dataset import PatternDataset, run


def rows():
    return [{'id':str(i),'episode_id':'episode:'+str(i),'kind':'sequence','level':'number',
             'source':'synthetic:test','context':'scale','split':split,'before':values,
             'after':[2*x for x in values]}
            for i,(split,values) in enumerate([('training',[1,3,5]),('training',[2,4,6,8]),
                                               ('training',[0,7,9,11,13]),('validation',[20,30]),('test',[40,50,60,70,80,90])])]

class PatternDatasetTests(unittest.TestCase):
    def setUp(self):self.engine=Engine(database=':memory:');self.dataset=PatternDataset(self.engine)
    def tearDown(self):self.engine.close()
    def test_split_isolation_and_read_only_evaluation(self):
        result=self.dataset.ingest('sample',rows())
        self.assertEqual(result['split_counts'],{'training':3,'validation':1,'test':1})
        self.assertEqual(self.engine.patterns.stats()['examples'],3)
        changes=self.engine.db.total_changes;stats=self.engine.patterns.stats()
        evaluation=self.dataset.evaluate('sample')
        for split in ('validation','test'):self.assertEqual(evaluation['summary'][split]['accuracy'],1.0)
        self.assertEqual(self.engine.db.total_changes,changes);self.assertEqual(self.engine.patterns.stats(),stats)
        self.assertEqual(self.dataset.ingest('sample',rows())['status'],'already_imported')
        self.assertEqual(self.engine.patterns.stats()['examples'],3)
    def test_invalid_batches_have_no_partial_learning(self):
        for modify in ('duplicate_id','episode_leak','input_leak','invalid_scalar'):
            items=rows()
            if modify=='duplicate_id':items[-1]['id']=items[0]['id']
            elif modify=='episode_leak':items[-1]['episode_id']=items[0]['episode_id']
            elif modify=='input_leak':items[-1]['before']=items[0]['before']
            else:items[-1]['before']=[float('nan')]
            with self.assertRaises(ValueError):self.dataset.ingest(modify,items)
            self.assertEqual(self.engine.patterns.stats()['examples'],0)
    def test_prior_import_and_existing_memory_leakage(self):
        self.dataset.ingest('one',rows())
        items=rows();items[-1]['before']=items[0]['before']
        with self.assertRaises(ValueError):self.dataset.ingest('two',items)
        changed=rows();changed[0]['after']=[999]
        with self.assertRaises(ValueError):self.dataset.ingest('one',changed)
        self.engine.patterns.learn_pair([999,1000],[1998,2000],'number','prior','scale')
        items=rows();items[-1]['before']=[999,1000]
        with self.assertRaises(ValueError):self.dataset.ingest('three',items)
    def test_failed_discovery_rolls_back_every_table(self):
        before=self.engine.patterns.stats()
        with patch.object(self.engine.discovery_patterns,'discover',side_effect=ValueError('simulated failure')):
            with self.assertRaises(ValueError):self.dataset.ingest('fail',rows())
        self.assertEqual(self.engine.patterns.stats(),before)
        self.assertEqual(self.engine.db.execute('SELECT count(*) FROM pattern_dataset_records').fetchone()[0],0)
        self.assertEqual(self.dataset.ingest('retry',rows())['status'],'imported')
    def test_request_and_raw_text(self):
        items=[{'id':'r1','episode_id':'r1','kind':'request','source':'test','context':'a','split':'training','text':'reverse letters'},
               {'id':'r2','episode_id':'r2','kind':'request','source':'test','context':'a','split':'test','text':'reverse new letters'},
               {'id':'raw','episode_id':'raw','kind':'raw_text','source':'test','context':None,'split':'training','text':'The cat drinks milk.'},
               {'id':'rawtest','episode_id':'rawtest','kind':'raw_text','source':'test','context':None,'split':'test','text':'The dog drinks water.'}]
        self.dataset.ingest('mixed',items);report=self.dataset.evaluate('mixed')
        self.assertEqual(report['summary']['test']['scored'],1)
        self.assertEqual(report['summary']['test']['correct'],1)
        self.assertFalse(next(c for c in report['cases'] if c['kind']=='raw_text')['scored'])
    def test_multimodal_and_cross_kind_leakage(self):
        items=[{'id':str(i),'episode_id':str(i),'kind':'multimodal','source':'test','context':'reverse',
                'split':split,'before':value,'after':value[::-1]}
               for i,(split,value) in enumerate([('training','ab'),('training','cde'),('training','fghij'),('test','klmnop')])]
        self.dataset.ingest('text',items)
        report=self.dataset.evaluate('text');self.assertEqual(report['summary']['test']['correct'],1)
        other=rows();other[-1].update(level='multimodal:text',context={'task':'reverse','format':{'modality':'text'}},before=list('ab'))
        with self.assertRaises(ValueError):self.dataset.ingest('cross-kind',other)
    def test_later_contamination_is_detected(self):
        self.dataset.ingest('sample',rows())
        heldout=rows()[-1]
        self.engine.patterns.learn_pair(heldout['before'],heldout['after'],heldout['level'],'later',heldout['context'])
        with self.assertRaises(ValueError):self.dataset.evaluate('sample')

    def test_file_metrics_and_api(self):
        import json
        from app import Application
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'dataset.jsonl';path.write_text('\n'.join(json.dumps(r) for r in rows()))
            report=run(path,str(Path(directory)/'memory.db'),'file')
            self.assertGreater(report['metrics']['python_traced_peak_bytes'],0)
            self.assertGreater(report['metrics']['sqlite_allocated_bytes'],0)
            self.assertEqual(report['evaluation']['summary']['test']['correct'],1)
        app=Application(self.engine)
        self.assertEqual(app.dispatch({'action':'pattern_dataset_import','name':'api','records':rows()})['status'],'imported')
        self.assertEqual(app.dispatch({'action':'pattern_dataset_evaluate','name':'api'})['summary']['test']['correct'],1)
