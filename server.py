"""Minimal local static server for the Bikting browser workspace."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class WorkspaceHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)


if __name__ == "__main__":
    address = ("127.0.0.1", 8000)
    print(f"Bikting Engine workspace: http://{address[0]}:{address[1]}")
    ThreadingHTTPServer(address, WorkspaceHandler).serve_forever()
