"""Default demo now exercises the binary foundation."""
from byte_demo import build_demo
from core import BinaryState, decode_outputs

if __name__ == '__main__':
    frames,result=build_demo()
    print('Verified byte operations:',len(result.program))
    print('Expanded binary states:',result.expansions)
    for index,raw in enumerate(result.snapshots):
        outputs=decode_outputs(BinaryState.decode(raw))
        outputs[4]=outputs[4][:8]
        print('Step',index,outputs)
    print('Run python byte_demo.py to generate the visible demo.')
