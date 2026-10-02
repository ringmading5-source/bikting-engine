"""Bounded forward chaining with learned text rules and learned QA templates.

Facts are supplied by the caller. Neither relation names nor transitivity are
installed. Consequences depend on supervised rules, not universal entailment.
"""
from text_transform_learning import checked_text
from text_gap_learning import tokens
from sentence_learning import detokenize
from pattern_memory import encoded


class RelationshipComposition:
    def __init__(self,engine):self.engine=engine

    def answer(self,facts,question,context=None,max_depth=2,max_facts=48,max_expansions=1000):
        if not isinstance(facts,list) or not 1<=len(facts)<=24:raise ValueError('1..24 supplied facts required')
        checked_text(question)
        for value,low,high in ((max_depth,0,4),(max_facts,len(facts),96),(max_expansions,1,5000)):
            if type(value) is not int or not low<=value<=high:raise ValueError('invalid search bounds')
        known={}
        for fact in facts:
            units=checked_text(fact);key=encoded(units)
            known.setdefault(key,{'text':detokenize(units),'depth':0,'parents':[],'model_ids':[]})
        expanded=0;limited=False;attempted=set();answers={}
        def collect():
            nonlocal limited
            for key,node in known.items():
                result=self.engine.text_relations.answer(node['text'],question,context)
                limited|=result['status']=='bounded'
                for candidate in result['candidates']:
                    item=answers.setdefault(candidate['answer'],{'answer':candidate['answer'],'evidence':[]})
                    if not any(e['fact']==key for e in item['evidence']):
                        item['evidence'].append({'fact':key,'qa_evidence':candidate['evidence']})
        collect()
        for depth in range(1,max_depth+1):
            snapshot=list(known.items());new={}
            # Unary and ordered binary compositions; the rule decides whether
            # a sequence matches and shared entity bindings are consistent.
            groups=([(key,) for key,_ in snapshot]+
                    [(a,b) for a,_ in snapshot for b,_ in snapshot if a!=b])
            for parents in groups:
                if parents in attempted:continue
                if expanded>=max_expansions:limited=True;break
                attempted.add(parents);expanded+=1
                text=' '.join(known[key]['text'] for key in parents)
                if len(tokens(text))>64 or len(text)>2000:continue
                result=self.engine.text_transforms.predict(text,context)
                limited|=result['status']=='bounded'
                for candidate in result['candidates']:
                    key=encoded(tokens(candidate['text']))
                    if key in known or key in new:continue
                    if len(known)+len(new)>=max_facts:limited=True;continue
                    new[key]={'text':candidate['text'],'depth':depth,'parents':list(parents),'model_ids':candidate['model_ids']}
            known.update(new);collect()
            if limited or not new:break
        return {'status':'bounded' if limited else 'answered' if len(answers)==1 else 'ambiguous' if answers else 'unknown',
                'candidates':list(answers.values()),'trace':known,'expansions':expanded,
                'max_depth':max_depth,'search_limited':limited,'verified':False,
                'scope':'Consequences of supplied facts under learned templates within search bounds; no universal entailment or factual verification.'}
