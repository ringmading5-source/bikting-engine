"""Interactive entry point for recognized inputs and persistent byte interactions."""
import json
import shlex
from core import BinaryState,decode_outputs

HELP='''Commands:
  import file PATH       ingest a structured relationship source and validate/import it
  import web URL         fetch a JSON relationship source and validate/import it
  recognize JSON        recognize an ordinary JSON value (quote text)
  interact JSON -> JSON match participants, compose relationships, verify target
  rules                 list stored relationship definitions and source references
  help                  show commands
  quit                  exit
Entity IDs in interact objects are integers, for example {"20":1,"30":"#000000"}.
'''

def participants(text):
    data=json.loads(text)
    if not isinstance(data,dict):raise ValueError('participant map required')
    output={}
    for key,value in data.items():
        entity=int(key)
        if str(entity)!=key or entity in output:raise ValueError('canonical integer entity IDs required')
        output[entity]=value
    return output


def command(engine,line):
    if line in ('help','?'):return {'help':HELP}
    if line=='rules':
        return {'rules':[json.loads(r.encode()[9:]) for r in engine.relationships.load().values()],
                'provenance':engine.relationship_sources.provenance()}
    if line.startswith('import '):
        args=shlex.split(line)
        if len(args)!=3 or args[1] not in ('file','web'):raise ValueError('import file PATH or import web URL')
        sid=engine.ingest_file(args[2]) if args[1]=='file' else engine.ingest_web(args[2])
        return {'source_id':sid,'imported':engine.relationship_sources.import_source(sid)}
    if line.startswith('recognize '):
        value=json.loads(line[len('recognize '):]);r=engine.recognize(value)
        return {'representation':r.representation,'decoded':decode_outputs(r.state),'bytes_hex':r.state.encode().hex()}
    if line.startswith('interact '):
        left,separator,right=line[len('interact '):].partition(' -> ')
        if not separator:raise ValueError('interact INPUT_JSON -> TARGET_JSON')
        result=engine.interact(participants(left),participants(right))
        trace=[]
        for raw in result.snapshots:
            state=BinaryState.decode(raw)
            trace.append({'decoded':decode_outputs(state),'participants':[{'entity':r.entity,'type':r.kind,'payload_hex':r.payload[:64].hex(),'payload_bytes':len(r.payload)} for r in state.records]})
        return {'accepted':result.accepted,'resolution':result.source,'reason':result.reason,'path':result.program,'trace':trace}
    raise ValueError('unsupported command; type help')


def session(engine):
    print(HELP)
    while True:
        try:line=input('B-STAE> ').strip()
        except (EOFError,KeyboardInterrupt):print();break
        if line in ('quit','exit'):break
        if not line:continue
        try:print(json.dumps(command(engine,line),ensure_ascii=False,indent=2))
        except Exception as error:print(json.dumps({'error':str(error)}))
