import tempfile
import unittest
from engine import Engine

class NumericTextTests(unittest.TestCase):
    def setUp(self):self.e=Engine(database=':memory:')
    def tearDown(self):self.e.close()
    def test_lossless_unicode_spacing(self):
        for text in ('three rabbits','  Café 🐇!\nthree\t cats.','猫和狗','e\u0301 cats'):
            packet=self.e.numeric_text.encode(text);before=self.e.db.total_changes
            self.assertEqual(self.e.numeric_text.decode(packet['sentence_id'])['text'],text)
            self.assertEqual(bytes(packet['byte_numbers']).decode('utf-8'),text)
            self.assertEqual(''.join(map(chr,packet['character_numbers'])),text)
            self.assertEqual(before,self.e.db.total_changes)
    def test_stable_words_new_sentence(self):
        first=self.e.numeric_text.encode('three cats')
        other=self.e.numeric_text.encode('two rabbits')
        unseen=self.e.numeric_text.encode('three rabbits')
        self.assertEqual(unseen['word_ids'],[first['word_ids'][0],other['word_ids'][1]])
        self.assertNotEqual(first['sentence_id'],unseen['sentence_id'])
        self.assertEqual(self.e.numeric_text.encode('three cats')['sentence_id'],first['sentence_id'])
        self.assertEqual(self.e.numeric_text.decode_tokens(unseen['token_ids']),'three rabbits')
    def test_bridge_training_links_numeric_hierarchy(self):
        import json
        from text_memory_demo import PLURAL
        self.e.text_memory.learn(PLURAL,'q')
        row=self.e.db.execute('SELECT example FROM bridge_examples ORDER BY id').fetchone()
        saved=json.loads(row[0])
        self.assertEqual(self.e.numeric_text.decode(saved['numeric_sentence_id'])['text'],PLURAL[0]['text'])
        self.assertEqual(self.e.numeric_text.decode(saved['numeric_string_fields']['entity'])['text'],'cat')
        packet=self.e.numeric_text.encode('three rabbits')
        text=self.e.numeric_text.decode(packet['sentence_id'])['text']
        self.assertEqual(self.e.text_memory.parse(text,'q')['candidates'][0]['record'],{'entity':'rabbit','count':3})
    def test_order_and_repetition_preserved(self):
        p=self.e.numeric_text.encode('cat cat dog')
        self.assertEqual(p['word_ids'][0],p['word_ids'][1])
        self.assertEqual(self.e.numeric_text.decode_tokens(list(reversed(p['token_ids']))),'dog cat cat')
    def test_restart_api(self):
        from app import Application
        with tempfile.TemporaryDirectory() as folder:
            first=Engine(database=folder+'/db');packet=Application(first).dispatch({'action':'numeric_text_encode','text':'three rabbits'});first.close()
            second=Engine(database=folder+'/db')
            try:
                self.assertEqual(Application(second).dispatch({'action':'numeric_text_decode','sentence_id':packet['sentence_id']})['text'],'three rabbits')
                self.assertEqual(second.numeric_text.encode('three rabbits')['token_ids'],packet['token_ids'])
            finally:second.close()
    def test_bounds_unknown_and_corruption(self):
        for value in ('','a'*4097,'a '*513,'\ud800'):
            with self.assertRaises(ValueError):self.e.numeric_text.encode(value)
        for ids in ([True],[999],[]):
            with self.assertRaises(ValueError):self.e.numeric_text.decode_tokens(ids)
        with self.assertRaises(ValueError):self.e.numeric_text.decode(999)
        p=self.e.numeric_text.encode('cat')
        self.e.db.execute('UPDATE numeric_characters SET bytes=? WHERE codepoint=?',('[100]',ord('c')))
        with self.assertRaises(ValueError):self.e.numeric_text.decode(p['sentence_id'])
