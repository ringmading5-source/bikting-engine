# B-STAE knowledge and procedure engine

B-STAE stores knowledge and explicit procedures, retrieves applicable memory,
composes bounded paths, and verifies deterministic execution. It does not fit
prediction weights or infer rules from training examples. The attached-LLM
cost-reduction APIs live in the Node engine; see ../MEMORY_COST_ENGINE.md.

## Run

```sh
python -m pip install -r requirements.txt
python app.py
python -m unittest discover -s tests -v
```

The app supports source retrieval, explicit procedure registration, deterministic
execution, stored phrase composition, and memory inspection. Public hosting
requires BSTAE_ACCESS_TOKEN; durable SQLite storage requires BSTAE_DB_PATH.
See RENDER.md for deployment configuration.

## Grounded paths

- knowledge.py, web_knowledge.py and soup_scraper.py store and retrieve cited sources.
- relationship_sources.py imports explicit relationship definitions and checks
  supplied before/after verification fixtures. Fixtures validate the declared
  procedure; they are not training data for rule inference.
- core.py, byte_relationships.py and bound_relationships.py execute typed byte
  operations, apply conditions, compose bounded paths, and reverify cached results.
- modality_memory.py stores explicit operations with a required source reference
  and format context. No observation-based inference is performed.
- intent_engine.py maps supported explicit operations to checked targets.
- recursive_sequences.py and word_sequences.py compose registered definitions,
  stopping for missing definitions, ambiguity, cycles, or budget exhaustion.
- concept_grounding.py and relationship_extraction.py extract bounded source-backed
  definitions and relationships, retaining evidence and uncertainty.
- capabilities.py, series_pipeline.py, recognition.py and output.py provide
  deterministic calculations, format adapters and rendering.

Examples of explicit local procedures:

```sh
python main.py --db knowledge.sqlite3 file examples/byte-relationships.json
python main.py --db knowledge.sqlite3 import-relations 1
python main.py --db knowledge.sqlite3 session
```

Session commands include `import file PATH`, `import web URL`, `recognize JSON`,
`interact INPUT_JSON -> TARGET_JSON`, and `rules`.

The API accepts `modality_register` with value, intent and source;
`modality_transform` with value and program; `modality_programs`;
`intent_execute`; `word_register`; `word_execute`; `research`; and `status`.
Explicit web phrase definitions use `word_relationships` entries with text,
intent or children, and an observations array for verification.

## Removed mechanisms

Trainable affine vector prediction, automatic byte-rule inference, inferred image
and modality transformations, behavior-sequence inference, prediction feedback
training flows, and their UI controls, examples, APIs and benchmarks are removed.
Old inferred database records are preserved for inspection but excluded from
executable relationship retrieval. Explicit modality procedures use a separate
stored_modality_programs table, so old inferred modality programs cannot be reused.
No automatic migration promotes inferred records to explicit knowledge.

## Limits

Exact byte agreement proves the declared transformation, not factual truth.
Source text is evidence, not automatically an executable rule. Supported phrase
handling and formats are bounded adapters, not general language or perception.
Standalone Python execution uses no LLM or GPU. The Node retrieval vectors are
deterministic feature hashes, not trained embeddings. Real workload cost savings
still need measurement.

## Shared multimodal representation (v1)

`representation.py` wraps modality-specific data in one validated, versioned
state: sequence IDs, timing, optional positions, relationships, and output code.
Text retains exact UTF-8, voice accepts mono PCM16 samples with sample rate,
and visuals accept RGB colors or integer 3D positions. This encodes supplied
data; it does not infer meaning, transcribe audio, or generate speech.

`represent` returns the canonical BSTA binary packet and SHA-256 state ID.
`representation_transition` accepts `state`, `steps` and optional `max_steps`
(1..64, default 16). Each step specifies `item`, explicit `intent`, and `expected`.
It executes existing checked operations, validates each resulting state, and
stores a trajectory only after all expected results match. The input is unchanged.
Missing IDs, inconsistent synchronization, overflow and exhausted step budgets
reject execution. A failed batch may populate the existing verified primitive
path cache, but never publishes a partial multimodal trajectory.

Output bits: `001` text, `010` voice, `100` visual; combine them up to `111`.
`000` stores an internal-only trajectory. Routing affects output, not execution.
`representation_trajectory` retrieves a hash-checked trajectory by ID after restart.
Run `python representation_demo.py` or use the shared-state panel in the app.
The browser plays supplied PCM audio and schedules captions/color/position views
against a common audio clock. Browser rendering is approximate; timing metadata
is checked deterministically. The example audio is a structural fixture, not speech.
