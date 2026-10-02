"""Synthetic evidence demonstration, not an externally verified zoology dataset."""
import json
from engine import Engine


def run():
    e=Engine(database=':memory:')
    try:
        pairs=[{'text':f'{actor} {action}s {obj}',
                'record':{'actor':actor,'action':action,'object':obj}}
               for actor,action,obj in [('dog','push','box'),('bird','lift','cart'),('robot','kick','ball')]]
        e.roles.learn(pairs)
        c=e.coherence
        c.observe({'kind':'membership','subject':'cat','class':'ordinary_cat','context':None},'synthetic:example')
        negative={'kind':'capability','subject':'ordinary_cat','action':'speak','object':'English','allowed':False,'context':None}
        original=c.observe(negative,'synthetic:ordinary-cat-default')['id']
        report={'ordinary_context':c.inspect('cat speaks English'),
                'missing_knowledge':c.inspect('robot speaks English')}
        c.observe({**negative,'subject':'cat','allowed':True,'context':'fiction'},'synthetic:talking-character')
        report['fiction']=c.inspect('cat speaks English',context='fiction')
        c.observe({**negative,'allowed':True},'synthetic:opposing-evidence')
        report['opposing_evidence']=c.inspect('cat speaks English')
        c.observe({**negative,'allowed':True},'synthetic:explicit-revision',supersedes=original)
        report['after_revision']=c.inspect('cat speaks English')
        report['scope']='Structured supplied evidence; no raw passage extraction, causal verification or universal meaning claim.'
        return report
    finally:e.close()

if __name__=='__main__':print(json.dumps(run(),indent=2,ensure_ascii=False))
