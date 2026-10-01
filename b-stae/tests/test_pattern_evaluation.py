import unittest
from pattern_evaluation import evaluate, TRAIN, VALIDATION, ORACLES


class PatternEvaluationTests(unittest.TestCase):
    def test_multiple_patterns_and_composition(self):
        report = evaluate()
        self.assertEqual(report['passed'], report['total'])
        self.assertEqual(report['summary']['unseen_prediction']['total'], 100)
        self.assertEqual(report['summary']['learning']['passed'], 4)
        self.assertEqual(report['model_calls'], 0)
        composition = next(c for c in report['cases'] if c['category'] == 'unseen_composition')['details']
        self.assertEqual(len(composition['plan']), 3)
        self.assertFalse(composition['verified_outcome'])
        self.assertEqual(composition['result'], {'x': 18, 'y': 4})
        excluded = set(TRAIN + VALIDATION)
        for case in report['cases']:
            if case['category'] == 'unseen_prediction':
                action, pair = case['case'].split(':')
                self.assertIn(action, ORACLES)
                self.assertNotIn(tuple(map(int, pair.split(','))), excluded)


if __name__ == '__main__':
    unittest.main()
