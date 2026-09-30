"""Recognize ordinary values/files and construct validated binary representations."""
from dataclasses import dataclass
from pathlib import Path
import re
import struct
import io
import wave
from core import BinaryState, Record, INT64, UTF8, RGB, PCM16, POSITION3, MAX_STATE

@dataclass(frozen=True)
class Recognized:
    state: BinaryState
    representation: str
    metadata: dict


def recognize(value, entity=1):
    """Python value type is context; raw bytes require format evidence."""
    if type(value) is bool: raise ValueError('boolean representation not implemented')
    if type(value) is int:
        return Recognized(BinaryState((Record(entity,INT64,struct.pack('<q',value)),)), 'int64', {})
    if isinstance(value,str):
        # Explicit CSS hex syntax is recognized as color; ordinary strings stay text.
        if re.fullmatch(r'#[0-9a-fA-F]{6}',value):
            return Recognized(BinaryState((Record(entity,RGB,bytes.fromhex(value[1:])),)), 'rgb24', {'notation':'css-hex'})
        return Recognized(BinaryState((Record(entity,UTF8,value.encode('utf-8')),)), 'utf8', {})
    if isinstance(value,dict) and set(value)=={'position'}:
        coordinates=value['position']
        if not isinstance(coordinates,list) or len(coordinates)!=3 or any(type(x) is not int for x in coordinates):raise ValueError('three integer position coordinates required')
        return Recognized(BinaryState((Record(entity,POSITION3,struct.pack('<iii',*coordinates)),)), 'position3', {'units':'adapter-defined'})
    if isinstance(value,dict) and set(value)=={'audio'}:
        audio=value['audio']
        if not isinstance(audio,dict) or set(audio)!={'samples','sample_rate'}:raise ValueError('audio samples and sample_rate required')
        samples=audio['samples'];rate=audio['sample_rate']
        if not isinstance(samples,list) or len(samples)>100000 or any(type(x) is not int or not -32768<=x<=32767 for x in samples) or type(rate) is not int or rate<=0:raise ValueError('bounded PCM16 samples and positive sample rate required')
        payload=struct.pack('<'+'h'*len(samples),*samples)
        return Recognized(BinaryState((Record(entity,PCM16,payload),)), 'pcm16', {'sample_rate':rate,'channels':1,'frames':len(samples)})
    if type(value) is bytes: return recognize_bytes(value,entity)
    if isinstance(value,Path): return recognize_file(value,entity)
    # Tuples deliberately not guessed as colors/positions.
    raise ValueError('unsupported or ambiguous input type; provide a supported value or file')


def recognize_bytes(data, entity=1):
    if len(data)>MAX_STATE-100: raise ValueError('input exceeds byte limit')
    if data.startswith(b'BSTA'):
        return Recognized(BinaryState.decode(data),'bsta-state',{'format_version':1})
    if data.startswith(b'RIFF') and data[8:12]==b'WAVE':
        with wave.open(io.BytesIO(data),'rb') as w:
            if w.getnchannels()!=1 or w.getsampwidth()!=2 or w.getcomptype()!='NONE':
                raise ValueError('supported WAV: mono uncompressed PCM16')
            rate,count=w.getframerate(),w.getnframes()
            payload=w.readframes(count)
            if len(payload)!=count*2: raise ValueError('truncated PCM frames')
        return Recognized(BinaryState((Record(entity,PCM16,payload),)), 'pcm16', {'sample_rate':rate,'channels':1,'frames':count})
    if data.startswith(b'P6'):
        return recognize_ppm(data,entity)
    if data.startswith((b'\x89PNG',b'\xff\xd8\xff',b'GIF87a',b'GIF89a',b'%PDF')):
        raise ValueError('recognized file family but decoder not implemented')
    if data.startswith(b'\xef\xbb\xbf'):
        text=data[3:].decode('utf-8',errors='strict')
        return Recognized(BinaryState((Record(entity,UTF8,text.encode('utf-8')),)),'utf8',{'bom':True})
    # Do not pretend arbitrary bytes establish text versus numeric/audio meaning.
    raise ValueError('ambiguous raw bytes; use a text file, Python text/number, WAV, PPM or BSTA file')


def recognize_ppm(data,entity=1):
    # Binary PPM P6: each pixel becomes an RGB record; dimensions retained outside payload.
    offset=0; tokens=[]
    while len(tokens)<4:
        while offset<len(data) and data[offset] in b' \t\r\n':offset+=1
        if offset<len(data) and data[offset]==35:
            end=data.find(b'\n',offset)
            if end<0:raise ValueError('invalid PPM comment')
            offset=end+1;continue
        end=offset
        while end<len(data) and data[end] not in b' \t\r\n':end+=1
        if end==offset:raise ValueError('truncated PPM header')
        tokens.append(data[offset:end]);offset=end
    if tokens[0]!=b'P6' or tokens[3]!=b'255':raise ValueError('supported PPM: P6 maxval 255')
    width,height=int(tokens[1]),int(tokens[2])
    if width<1 or height<1 or width*height>65535:raise ValueError('unsupported image dimensions')
    if offset>=len(data) or data[offset] not in b' \t\r\n':raise ValueError('missing PPM delimiter')
    offset+=1 # Exactly one byte: pixel bytes may themselves be whitespace.
    pixels=data[offset:]
    if len(pixels)!=width*height*3:raise ValueError('PPM pixel length mismatch')
    state=BinaryState(tuple(Record(entity+i,RGB,pixels[i*3:i*3+3]) for i in range(width*height)))
    return Recognized(state,'ppm-rgb24',{'width':width,'height':height,'first_entity':entity})


def recognize_file(path,entity=1):
    path=Path(path)
    if path.stat().st_size>MAX_STATE-100:raise ValueError('input exceeds byte limit')
    data=path.read_bytes()
    if data.startswith((b'BSTA',b'RIFF',b'P6',b'\x89PNG',b'\xff\xd8\xff',b'GIF87a',b'GIF89a',b'%PDF')):
        result=recognize_bytes(data,entity)
    elif path.suffix.lower() in ('.txt','.md','.json','.csv','.html','.htm'):
        # File extension supplies context, but strict decoding still validates bytes.
        text=data.decode('utf-8-sig',errors='strict')
        result=Recognized(BinaryState((Record(entity,UTF8,text.encode('utf-8')),)),'utf8',{'extension':path.suffix.lower()})
    else:result=recognize_bytes(data,entity)
    return Recognized(result.state,result.representation,dict(result.metadata,filename=path.name))
