"""Persistent passage facts with learned recognition and bounded composition.

Raw passages need no per-sentence labels. Recognition/normalization/composition
still depend on supervised templates; this is not unsupervised semantics.
"""
import json
from text_gap_learning import tokens
from text_relationship_learning import bind
from sentence_learning import detokenize
from text_transform_learning import checked_text
from pattern_memory import encoded


def sentences(text):
    current=[];result=[]
    for unit in tokens(text):
        current.append(unit)
        if unit in ('.','!','?'):
            if any(x.isalnum() for x in current):result.append(detokenize(current))
            current=[]
    if any(x.isalnum() for x in current):result.append(detokenize(current))
    return result


class PassageKnowledge:
    def __init__(self,engine):
        self.engine=engine;self.db=engine.db
        self.db.executescript('''CREATE TABLE IF NOT EXISTS knowledge_passages (
            id INTEGER PRIMARY KEY, context TEXT NOT NULL, source TEXT NOT NULL, text TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS knowledge_passage_facts (
            id INTEGER PRIMARY KEY, passage INTEGER NOT NULL, sentence TEXT NOT NULL,
            canonical TEXT NOT NULL, recognized INTEGER NOT NULL, evidence TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS passage_context ON knowledge_passages(context);''')

    def recognize(self,text,context):
        patterns=[]
        for ident,model in self.engine.text_relations.models(context):patterns.append((ident,model['statement']))
        for row in self.db.execute('SELECT id,parameters FROM text_transform_models WHERE context=?',(encoded(context),)):
            pattern=json.loads(row['parameters'])['input_pattern'];part=[]
            # Learnable relation spans come from fitted templates; only sentence
            # punctuation is structural. No relation-name list is installed.
            for unit in pattern:
                part.append(unit)
                if unit.get('literal') in ('.','!','?'):
                    patterns.append((row['id'],part));part=[]
            if part:patterns.append((row['id'],part))
        evidence=[];limited=False
        for ident,pattern in patterns:
            bindings,bounded=bind(pattern,tokens(text));limited|=bounded
            if bindings:evidence.append({'model_id':ident,'bindings':bindings})
        return evidence,limited

    def learn(self,text,source,context=None):
        if not isinstance(text,str) or not text.strip() or len(text)>20000:raise ValueError('nonempty passage up to 20000 characters required')
        if not isinstance(source,str) or not source.strip() or len(source)>512:raise ValueError('source up to 512 characters required')
        parts=sentences(text)
        if not 1<=len(parts)<=64:raise ValueError('1..64 sentences required')
        prepared=[];limited=False
        for sentence in parts:
            checked_text(sentence)
            evidence,bounded=self.recognize(sentence,context);limited|=bounded
            canonical={sentence:evidence}
            normalized=self.engine.text_transforms.predict(sentence,context)
            limited|=normalized['status']=='bounded'
            for candidate in normalized['candidates']:
                matched,bounded=self.recognize(candidate['text'],context);limited|=bounded
                if matched:canonical[candidate['text']]=matched+[{'normalization_models':candidate['model_ids']}]
            for value,proof in canonical.items():prepared.append((sentence,value,bool(proof),proof))
        with self.db:
            ident=self.db.execute('INSERT INTO knowledge_passages(context,source,text) VALUES (?,?,?)',(encoded(context),source,text)).lastrowid
            for sentence,value,recognized,evidence in prepared:
                self.db.execute('INSERT INTO knowledge_passage_facts(passage,sentence,canonical,recognized,evidence) VALUES (?,?,?,?,?)',
                    (ident,sentence,value,int(recognized),encoded(evidence)))
        return {'status':'bounded' if limited else 'learned','passage_id':ident,'sentences':len(parts),
                'recognized_forms':sum(x[2] for x in prepared),'retained_forms':len(prepared),
                'scope':'Passage statements recognized through previously fitted templates; unsupported sentences retained.'}

    def _compose_answer(self,question,context=None,max_depth=2,max_expansions=1000):
        checked_text(question);facts={}
        for row in self.db.execute('''SELECT f.*,p.source FROM knowledge_passage_facts f
                JOIN knowledge_passages p ON p.id=f.passage WHERE p.context=? AND f.recognized=1 ORDER BY f.id''',(encoded(context),)):
            key=encoded(tokens(row['canonical']))
            item=facts.setdefault(key,{'text':row['canonical'],'sources':[]})
            item['sources'].append({'source':row['source'],'passage_id':row['passage'],'sentence':row['sentence'],
                                    'recognition':json.loads(row['evidence'])})
        if not facts:return {'status':'unknown','candidates':[],'trace':{},'knowledge_facts':0,'verified':False}
        if len(facts)>24:return {'status':'bounded','candidates':[],'trace':{},'knowledge_facts':len(facts),
                                'search_limited':True,'reason':'More than 24 recognized facts; use a narrower context.','verified':False}
        result=self.engine.relationship_composition.answer([v['text'] for v in facts.values()],question,context,
                                                           max_depth=max_depth,max_expansions=max_expansions)
        for key,node in result['trace'].items():
            if key in facts:node['sources']=facts[key]['sources']
        result['knowledge_facts']=len(facts)
        result['scope']='Composition over earlier passage statements using supervised templates; stored knowledge is read, stored answers are not looked up.'
        return result

    def answer(self,question,context=None,max_depth=2,max_expansions=1000):
        if type(max_depth) is not int or not 0<=max_depth<=4:raise ValueError('depth 0..4 required')
        if type(max_expansions) is not int or not 1<=max_expansions<=5000:raise ValueError('expansion budget 1..5000 required')
        composed=self._compose_answer(question,context,max_depth,max_expansions)
        span_result=self.engine.span_questions.answer(question,context)
        if not span_result['candidates'] and not span_result['search_limited']:return composed
        candidates={}
        for result in (composed,span_result):
            for candidate in result['candidates']:
                item=candidates.setdefault(candidate['answer'],{'answer':candidate['answer'],'evidence':[]})
                item['evidence'].extend(candidate['evidence'])
        limited=composed.get('search_limited',False) or composed['status']=='bounded' or span_result['search_limited']
        trace=dict(composed['trace']);trace.update(span_result['trace'])
        return {**composed,'status':'bounded' if limited else 'answered' if len(candidates)==1 else 'ambiguous' if candidates else 'unknown',
                'candidates':list(candidates.values()),'trace':trace,'search_limited':limited,'span_question_path':span_result,
                'scope':'Combined learned sentence composition and question mappings onto unlabeled passage spans; no stored-answer lookup.'}

    def evaluate(self,cases,context=None,max_depth=2):
        if not isinstance(cases,list) or not 1<=len(cases)<=100:raise ValueError('1..100 question/expected cases required')
        # Reject repeated questions and literal training labels, not just answers.
        training_questions={encoded(tokens(json.loads(r['record'])['question'])) for r in self.db.execute(
            'SELECT record FROM text_relation_examples WHERE context=?',(encoded(context),))}
        training_questions.update(encoded(tokens(e['question'])) for row in self.db.execute(
            'SELECT training FROM span_question_models WHERE context=?',(encoded(context),)) for e in json.loads(row['training']))
        seen=set();prepared=[]
        for case in cases:
            if not isinstance(case,dict) or set(case)!={'question','expected'}:raise ValueError('question/expected required')
            key=encoded(checked_text(case['question']));checked_text(case['expected'])
            if key in seen or key in training_questions:raise ValueError('question repeats evaluation or training')
            seen.add(key);prepared.append(case)
        before=self.db.total_changes;results=[]
        for case in prepared:
            prediction=self.answer(case['question'],context,max_depth)
            baseline=self._compose_answer(case['question'],context,0)
            def correct(result):
                return result['status']=='answered' and tokens(result['candidates'][0]['answer'])==tokens(case['expected'])
            results.append({**case,'status':prediction['status'],'answers':[c['answer'] for c in prediction['candidates']],
                            'correct':correct(prediction),'direct_baseline_correct':correct(baseline)})
        if self.db.total_changes!=before:raise RuntimeError('evaluation changed learning state')
        return {'total':len(results),'correct':sum(r['correct'] for r in results),
                'direct_baseline_correct':sum(r['direct_baseline_correct'] for r in results),'cases':results,
                'learning_updates':0,'scope':'Questions absent from supervised QA labels; passage facts may support answers. Synthetic structural benchmark.'}
