"""Versioned JSONL observations and episode-disjoint offline evaluation."""
import argparse
from datetime import datetime
import hashlib
import json
import math
from pathlib import Path
from representation import canonical
from transition_learning import TransitionLearning

OBSERVATION_FIELDS = {'before', 'after', 'action', 'context', 'relationships', 'outcome', 'source'}
METADATA_FIELDS = {'version', 'id', 'episode_id', 'timestamp', 'uncertainty', 'split'}


def validate_record(record):
    if not isinstance(record, dict) or set(record) != OBSERVATION_FIELDS | METADATA_FIELDS:
        raise ValueError('complete versioned observation record required')
    if type(record['version']) is not int or record['version'] != 1:
        raise ValueError('unsupported dataset version')
    for key in ('id', 'episode_id'):
        if not isinstance(record[key], str) or not 1 <= len(record[key]) <= 128:
            raise ValueError('bounded record and episode IDs required')
    if record['split'] not in ('training', 'validation', 'test'):
        raise ValueError('explicit training, validation or test split required')
    if not isinstance(record['timestamp'], str):
        raise ValueError('timestamp required')
    try:
        timestamp = datetime.fromisoformat(record['timestamp'].replace('Z', '+00:00'))
    except ValueError as exc:
        raise ValueError('ISO timestamp required') from exc
    if timestamp.tzinfo is None:
        raise ValueError('timestamp timezone required')
    uncertainty = record['uncertainty']
    if type(uncertainty) not in (int, float) or not math.isfinite(uncertainty) or not 0 <= uncertainty <= 1:
        raise ValueError('uncertainty must be a finite number in [0,1]')
    observation = {key: record[key] for key in OBSERVATION_FIELDS}
    TransitionLearning.observation(None, observation)
    return observation


def load_dataset(path):
    records = []
    with open(path, encoding='utf-8') as stream:
        for line_number, line in enumerate(stream, 1):
            if line_number > 4096 or len(line.encode('utf-8')) > 65536:
                raise ValueError('dataset exceeds bounded import size')
            try:
                record = json.loads(line)
                validate_record(record)
            except (ValueError, TypeError) as exc:
                raise ValueError(f'line {line_number}: {exc}') from exc
            records.append(record)
    return validate_dataset(records)


def validate_dataset(records):
    if not isinstance(records, list) or not 5 <= len(records) <= 64:
        raise ValueError('5..64 records required per model dataset')
    splits = {name: [] for name in ('training', 'validation', 'test')}
    ids = set(); episodes = {}; inputs = {}; expected = None
    for record in records:
        observation = validate_record(record)
        # Current exact learner has no noise model: uncertain data cannot be fitted.
        if record['uncertainty'] != 0:
            raise ValueError('exact learner requires zero declared uncertainty')
        identity = canonical([TransitionLearning.observation(None, observation), sorted(observation['before'])])
        if expected is None:
            expected = identity
        if identity != expected:
            raise ValueError('one gate and state schema required per dataset')
        if record['id'] in ids:
            raise ValueError('duplicate record ID')
        ids.add(record['id'])
        split = record['split']
        episode = record['episode_id']
        if episode in episodes and episodes[episode] != split:
            raise ValueError('episode leakage across splits')
        episodes[episode] = split
        input_key = canonical(observation['before'])
        if input_key in inputs:
            raise ValueError('duplicate input state or split leakage')
        inputs[input_key] = split
        splits[split].append(observation)
    if not 3 <= len(splits['training']) <= 32 or not 1 <= len(splits['validation']) <= 16 or not 1 <= len(splits['test']) <= 16:
        raise ValueError('requires 3..32 training, 1..16 validation and 1..16 test records')
    digest = hashlib.sha256(canonical(sorted(records, key=lambda r: r['id']))).hexdigest()
    return {'records': records, 'splits': splits, 'sha256': digest}


def evaluate_dataset(dataset, database=':memory:'):
    from engine import Engine
    from coupled_transition_learning import CoupledTransitionLearning
    # Revalidate callers supplying an in-memory dataset.
    dataset = validate_dataset(dataset['records'])
    engine = Engine(database=database)
    try:
        learner = CoupledTransitionLearning(engine)
        split = dataset['splits']
        learned = learner.learn(split['training'], split['validation'])
        report = {'dataset_sha256': dataset['sha256'], 'learning': learned,
                  'counts': {k: len(v) for k, v in split.items()}, 'model_calls': 0,
                  'scope': 'exact coupled affine hypothesis; test observations never fit or update the model'}
        if learned['status'] != 'hypothesis_saved':
            report['status'] = learned['status']
            return report
        cases = []
        for item in split['test']:
            prediction = learner.predict(learned['model_id'], item['before'], item['action'], item['context'], item['relationships'])
            cases.append({'before': item['before'], 'expected': item['after'], 'prediction': prediction,
                          'passed': prediction.get('status') == 'predicted' and prediction.get('state') == item['after']})
        passed = sum(case['passed'] for case in cases)
        report.update(status='test_passed' if passed == len(cases) else 'test_failed', passed=passed, total=len(cases), cases=cases)
        # A failed final test must not leave an executable active hypothesis.
        if passed != len(cases):
            with engine.db:
                engine.db.execute('UPDATE contextual_transition_models SET active=0 WHERE id=?', (learned['model_id'],))
            learned['active'] = False
        with engine.db:
            engine.db.execute('CREATE TABLE IF NOT EXISTS dataset_runs (id INTEGER PRIMARY KEY, dataset_sha256 TEXT NOT NULL, payload TEXT NOT NULL)')
            engine.db.execute('INSERT INTO dataset_runs(dataset_sha256,payload) VALUES (?,?)', (dataset['sha256'], canonical(report).decode()))
        return report
    finally:
        engine.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dataset', type=Path)
    parser.add_argument('--database', default=':memory:')
    args = parser.parse_args()
    try:
        report = evaluate_dataset(load_dataset(args.dataset), args.database)
    except ValueError as exc:
        parser.error(str(exc))
    print(json.dumps(report, indent=2))
    return 0 if report['status'] == 'test_passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
