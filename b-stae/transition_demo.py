"""Synthetic inventory observations; not observations of a physical warehouse."""
def observation(x):
    return {'before':{'stock':x,'total_received':2*x},'after':{'stock':x+5,'total_received':2*x+5},'action':'receive_batch','context':{'warehouse':'A','batch_units':'5'},'relationships':[{'from':'item','kind':'stored_in','to':'warehouse_A'}],'outcome':'observed','source':'simulator:inventory-v1'}

def example():
    item=observation(15)
    return {'training':{'action':'transition_learn','examples':[observation(0),observation(10),observation(20)],'validation':[observation(5)]},'prediction':{'action':'transition_predict','model_id':'','state':item['before'],'transition_action':item['action'],'context':item['context'],'relationships':item['relationships']}}
