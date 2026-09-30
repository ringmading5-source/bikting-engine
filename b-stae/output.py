"""Render typed binary states back to ordinary formats without model calls."""
import io
import json
import struct
import wave
from recognition import Recognized
from core import INT64,UTF8,RGB,PCM16,POSITION3


def render(recognized):
    state,kind,meta=recognized.state,recognized.representation,recognized.metadata
    if kind=='bsta-state':return state.encode(),'.bsta'
    if kind=='ppm-rgb24':
        width,height,first=meta['width'],meta['height'],meta['first_entity']
        if len(state.records)!=width*height:raise ValueError('image record count mismatch')
        pixels=[]
        for i in range(width*height):
            r=state.get(first+i)
            if r is None or r.kind!=RGB:raise ValueError('image pixel schema mismatch')
            pixels.append(r.payload)
        return f'P6\n{width} {height}\n255\n'.encode()+b''.join(pixels),'.ppm'
    if len(state.records)!=1:raise ValueError('single-record output required')
    r=state.records[0]
    if kind=='int64' and r.kind==INT64:
        return (str(struct.unpack('<q',r.payload)[0])+'\n').encode(),'.json'
    if kind=='utf8' and r.kind==UTF8:return r.payload,'.txt'
    if kind=='rgb24' and r.kind==RGB:return ('#'+r.payload.hex()+'\n').encode(),'.txt'
    if kind=='pcm16' and r.kind==PCM16:
        rate=meta.get('sample_rate')
        if type(rate) is not int or rate<=0 or meta.get('channels')!=1:raise ValueError('valid mono sample-rate metadata required')
        b=io.BytesIO()
        with wave.open(b,'wb') as w:
            w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate);w.writeframes(r.payload)
        return b.getvalue(),'.wav'
    raise ValueError('representation/schema mismatch')
