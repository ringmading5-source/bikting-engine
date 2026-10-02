import unittest
from engine import Engine
from app import Application

class FirstWordTests(unittest.TestCase):
 def setUp(self):self.engine=Engine(database=':memory:');self.gaps=self.engine.text_gaps
 def tearDown(self):self.engine.close()
 def test_unseen_and_interior_exclusion(self):
  self.gaps.learn('Chemistry studies matter in laboratories. We know physics studies matter in classrooms.','training')
  before=self.engine.db.total_changes
  result=self.gaps.predict_first('studies matter during experiments.')
  self.assertEqual(result['status'],'predicted')
  self.assertEqual(result['preferred'][0]['token'],'chemistry')
  self.assertNotIn('physics',[x['token'] for x in result['candidates']])
  self.assertEqual(self.engine.db.total_changes,before)
 def test_ambiguity_and_unknown(self):
  self.gaps.learn('She went to school. He went to school.','training')
  result=self.gaps.predict_first('went to school yesterday.')
  self.assertEqual(result['status'],'ambiguous')
  self.assertEqual({x['token'] for x in result['preferred']},{'she','he'})
  self.assertEqual(self.gaps.predict_first('orbits distant galaxies.')['status'],'unknown')
 def test_quoted_start_context_and_api(self):
  self.gaps.learn('An introduction. “Biology studies living organisms.”','training','science')
  result=Application(self.engine).dispatch({'action':'text_first_predict','text':'studies living organisms today.','context':'science'})
  self.assertEqual(result['preferred'][0]['token'],'biology')
  self.assertEqual(self.gaps.predict_first('studies living organisms today.')['status'],'unknown')
 def test_validation(self):
  for text in ('','<mask> goes home',None):
   with self.assertRaises(ValueError):self.gaps.predict_first(text)
