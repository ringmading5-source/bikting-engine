"""Single lifecycle and checkpoint API for the existing model components."""
from pathlib import Path
import sqlite3

class Model:
    def __init__(self, database=':memory:'):
        try:
            from ._core.engine import Engine
        except ModuleNotFoundError as error:
            if error.name != 'bstae._core': raise
            from engine import Engine
        self._engine = Engine(database=str(database))
        self._application = None
        self._closed = False

    def _require_open(self):
        if self._closed: raise RuntimeError('model is closed')

    @property
    def components(self):
        """Access every existing engine component for specialized workflows."""
        self._require_open()
        return self._engine

    def request(self, action, **payload):
        """Run any existing explicit application action; no automatic routing."""
        self._require_open()
        if not isinstance(action,str) or not action: raise ValueError('action required')
        if self._application is None:
            if self._engine.__class__.__module__.startswith('bstae._core.'):
                from ._core.app import Application
            else:
                from app import Application
            self._application = Application(self._engine)
        return self._application.dispatch({'action':action, **payload})

    def learn_roles(self, examples, context=None):
        self._require_open()
        return self._engine.roles.learn(examples,context)

    def observe_relationship(self, assertion, source, supersedes=None):
        self._require_open()
        return self._engine.coherence.observe(assertion,source,supersedes)

    def predict(self, text, role_context=None, context=None, level='byte'):
        """Predict roles and check their consistency with stored evidence."""
        self._require_open()
        return self._engine.coherence.inspect(text,role_context,context,level)

    def save(self, destination):
        """Checkpoint the entire live SQLite memory, including in-memory models."""
        self._require_open()
        destination=Path(destination).resolve()
        destination.parent.mkdir(parents=True,exist_ok=True)
        with destination.open('xb'): pass
        try:
            with sqlite3.connect(destination) as target:
                self._engine.db.backup(target)
                if target.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise ValueError('checkpoint integrity failed')
        except Exception:
            destination.unlink(missing_ok=True)
            raise
        return str(destination)

    @classmethod
    def load(cls, checkpoint, database=':memory:'):
        """Load an independent copy; never modifies the checkpoint."""
        source=Path(checkpoint).resolve()
        if not source.is_file(): raise ValueError('existing checkpoint required')
        if str(database) != ':memory:':
            destination=Path(database).resolve()
            if destination.exists(): raise ValueError('load destination must not exist')
            destination.parent.mkdir(parents=True,exist_ok=True)
        else: destination=None
        with sqlite3.connect(source.as_uri()+'?mode=ro',uri=True) as incoming:
            if incoming.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('invalid checkpoint')
            required={'bridge_examples','bridge_models','coherence_evidence'}
            tables={r[0] for r in incoming.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if not required <= tables: raise ValueError('B-STAE checkpoint required')
            model=cls(database)
            try:
                # Restore older memory, then retain missing additive schemas.
                schema=list(model._engine.db.execute("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type DESC"))
                incoming.backup(model._engine.db)
                names={r[0] for r in model._engine.db.execute('SELECT name FROM sqlite_master')}
                with model._engine.db:
                    for definition in schema:
                        if definition['name'] not in names:model._engine.db.execute(definition['sql'])
            except Exception:
                model.close()
                if destination: destination.unlink(missing_ok=True)
                raise
        return model

    def close(self):
        if not self._closed:
            self._engine.close()
            self._closed=True

    def __enter__(self):
        self._require_open()
        return self

    def __exit__(self, *_): self.close()
