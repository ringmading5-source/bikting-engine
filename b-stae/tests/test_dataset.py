import copy
import json
import tempfile
import unittest
from pathlib import Path
from dataset import validate_dataset, load_dataset, evaluate_dataset
from evaluation import observation
from engine import Engine
from coupled_transition_learning import CoupledTransitionLearning


def records():
    result = []
    for i, (x, y, split) in enumerate([(0,0,'training'), (20,0,'training'), (0,20,'training'), (20,20,'training'), (5,10,'validation'), (7,9,'test'), (11,3,'test')]):
        result.append(dict(observation(x,y), version=1, id=f'obs-{i}', episode_id=f'episode-{i}', timestamp='2026-10-01T00:00:00Z', uncertainty=0, split=split))
    return result


class DatasetTests(unittest.TestCase):
    def test_jsonl_to_held_out_evaluation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'records.jsonl'
            path.write_text(''.join(json.dumps(r)+'\n' for r in records()))
            report = evaluate_dataset(load_dataset(path))
        self.assertEqual(report['status'], 'test_passed')
        self.assertEqual(report['passed'], 2)
        self.assertEqual(report['model_calls'], 0)
        self.assertEqual(report['learning']['training_count'], 4)
        self.assertEqual(report['learning']['held_out_count'], 1)

    def test_leakage_and_invalid_evidence(self):
        mutations = [lambda r: r[5].update(episode_id=r[0]['episode_id']),
                     lambda r: r[5].update(before=copy.deepcopy(r[0]['before'])),
                     lambda r: r[5].update(id=r[0]['id']),
                     lambda r: r[0].update(timestamp='2026-10-01'),
                     lambda r: r[0].update(uncertainty=float('nan')),
                     lambda r: r[0].update(uncertainty=0.2),
                     lambda r: r[0].update(version=True),
                     lambda r: r[5].update(context={'mode':'2'})]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                value=records(); mutation(value)
                with self.assertRaises(ValueError): validate_dataset(value)

    def test_test_failure_disables_without_training_on_test(self):
        value=records(); value[5]['after']['stock']=999
        with tempfile.TemporaryDirectory() as directory:
            db=str(Path(directory)/'memory.db')
            report=evaluate_dataset(validate_dataset(value),db)
            self.assertEqual(report['status'],'test_failed')
            e=Engine(database=db)
            try:
                learner=CoupledTransitionLearning(e)
                model,active=learner.get(report['learning']['model_id'])
                self.assertFalse(active)
                self.assertEqual(len(model['examples']),4)
                self.assertEqual(e.db.execute('SELECT count(*) FROM dataset_runs').fetchone()[0],1)
            finally:e.close()

    def test_order_independent_fingerprint(self):
        value=records()
        self.assertEqual(validate_dataset(value)['sha256'],validate_dataset(list(reversed(value)))['sha256'])
