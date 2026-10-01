"""Synthetic labeled sentences; the learner has no inventory sentence rules."""
def example():
    from evaluation import observation
    def item(stock,incoming,style):
        o=observation(stock,incoming)
        text=(f'I have {stock} items and receive {incoming} more. How many now?' if style==0 else f'{incoming} arrived; I already had {stock}.')
        return {'text':text,'state':o['before'],'action':o['action'],'context':o['context'],'relationships':o['relationships'],'source':'synthetic:text-pairs-v1'}
    return {'examples':[item(x,y,s) for s in (0,1) for x,y in [(1,4),(2,6),(3,8)]],
            'validation':[item(5,10,0),item(6,11,1)]}
