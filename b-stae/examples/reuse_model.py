"""Run after installing bikting-bstae: python b-stae/examples/reuse_model.py."""
import tempfile
from pathlib import Path
from bstae import Model

examples=[{'text':f'{a} {v}s {o}','record':{'actor':a,'action':v,'object':o}}
          for a,v,o in [('cat','push','box'),('dog','lift','cart'),('bird','kick','ball')]]

def main():
    with tempfile.TemporaryDirectory() as directory:
        checkpoint=Path(directory)/'trained.sqlite3'
        with Model() as model:
            model.learn_roles(examples)
            model.observe_relationship({'kind':'capability','subject':'cat','action':'speak',
                'object':'English','allowed':False,'context':None},'synthetic:example')
            model.save(checkpoint)
        with Model.load(checkpoint) as reused:
            result=reused.predict('cat speaks English')
            print(result['status'])
            print(result['readings'][0]['record'])

if __name__=='__main__':main()
