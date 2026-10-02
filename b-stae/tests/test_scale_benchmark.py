import unittest
from scale_benchmark import benchmark

class ScaleBenchmarkTests(unittest.TestCase):
    def test_isolated_holdouts_conflicts_and_metrics(self):
        result=benchmark(3,lexical_tests=2)
        self.assertEqual(result['training_records'],18)
        self.assertEqual(result['groups']['new_words']['correct_records'],12)
        self.assertEqual(result['groups']['new_structure']['unknown'],30)
        self.assertEqual(result['groups']['missing_punctuation']['unknown'],30)
        self.assertTrue(all(x['status']=='ambiguous' for x in result['conflict_checks']))
        self.assertEqual(result['inference_learning_updates'],0)
        self.assertGreater(result['sqlite_allocated_bytes_after_conflicts'],0)
        self.assertGreaterEqual(result['latency_ms_p95'],result['latency_ms_median'])
