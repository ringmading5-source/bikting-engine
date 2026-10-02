"""Package legacy modules privately without changing existing script imports."""
import ast
from pathlib import Path
from setuptools import setup
from setuptools.command.build_py import build_py

ROOT=Path(__file__).parent

class BuildCore(build_py):
    def run(self):
        super().run()
        target=Path(self.build_lib)/'bstae'/'_core'
        target.mkdir(parents=True,exist_ok=True)
        (target/'__init__.py').write_text('"""Private compatibility modules."""\n')
        sources={p.stem:p for p in ROOT.glob('*.py') if p.name!='setup.py'}
        for name,path in sources.items():
            # AST locations use UTF-8 byte offsets; edit bytes to preserve Unicode.
            raw=path.read_bytes();lines=raw.splitlines(keepends=True)
            offsets=[0]
            for line in lines:offsets.append(offsets[-1]+len(line))
            changes=[]
            for node in ast.walk(ast.parse(raw)):
                replacement=None
                if isinstance(node,ast.ImportFrom) and node.level==0 and node.module in sources:
                    node.level=1;replacement=ast.unparse(node)
                elif isinstance(node,ast.Import) and any(a.name in sources for a in node.names):
                    replacement='; '.join(('from . import ' if a.name in sources else 'import ')+
                        a.name+(' as '+a.asname if a.asname else '') for a in node.names)
                if replacement is not None:
                    changes.append((offsets[node.lineno-1]+node.col_offset,
                                    offsets[node.end_lineno-1]+node.end_col_offset,replacement.encode()))
            for start,end,replacement in sorted(changes,reverse=True):raw=raw[:start]+replacement+raw[end:]
            (target/(name+'.py')).write_bytes(raw)
        for asset in ('app.html','byte-demo.html','chat.html','media.html'):
            source=ROOT.parent/'chatbot'/'index.html' if asset=='chat.html' else ROOT/asset
            (target/asset).write_bytes(source.read_bytes())

setup(packages=['bstae'],cmdclass={'build_py':BuildCore})
