# Run B-STAE

1. Extract the archive.
2. Open a terminal in the `b-stae` directory.
3. Run `python app.py` (or `python3 app.py`).
4. Open http://127.0.0.1:8765.
5. Click **Load example observations**.
6. Transform text `New` or color `#102030` and inspect the byte trace.

The example learner infers transformations from before/after examples; it does not receive their rule definitions. Separate validation examples check the inferred relationships. Predictions use a unique applicable stored outcome; ambiguity causes abstention.

Keep `knowledge.sqlite3` to retain learned relationships and paths. Press Ctrl+C in the terminal to stop the app.

Python 3.10 or later is required. No third-party packages or LLM credentials are needed. See README.md for capabilities, format details and the remaining limits.
