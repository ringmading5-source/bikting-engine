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

## Complete tasks and independent goals

`task_execute` accepts `text`, `value`, `goal: {equals: EXPECTED}`, optional
`output_code`, `max_actions` (default 16) and `use_gemini` (default false).
It resolves registered word relationships, a bounded English numeric grammar,
or explicit operations; `then` composes operations. Missing definitions,
conflicts, cycles and exceeded budgets stop the task. All intermediate typed
states and the independently supplied goal are checked before execution.
Successful requests store context/version/definition-bound plans; repeated
requests avoid Gemini and still execute and verify every operation.

The test suite covers a previously unregistered combination of two registered
phrases. This is compositional reuse, not learned or universal generalization.
`representation_transition` continues to provide the shared multimodal trajectory.
Task output presents the verified result as text, a structured view, and optionally
browser speech synthesis. Speech onset/duration is device dependent; the task
view does not claim sample-accurate speech synchronization.

`input_decode` supports bounded base64 UTF-8, PCM16 WAV and P6 PPM.
`artifact_create` stores and reads back named text/JSON/SVG bytes in SQLite and
returns a downloadable payload; filenames cannot select arbitrary filesystem paths.
The task panel can download a verified result. Existing capability APIs provide
checked numeric plots. Input decoding is not speech transcription or image semantics.

## Durable memory and backups

Set `BSTAE_DB_PATH` to a path on an actual persistent disk, for example
`/var/data/bstae/knowledge.sqlite3`, only after mounting that disk on the host.
No disk is provisioned or paid plan selected by this code. `storage_status`
reports configuration without mistaking an environment variable for persistence.
For an operator checkpoint use:

```sh
python storage_backup.py knowledge.sqlite3 /persistent/backups/checkpoint.sqlite3
```

The backup uses SQLite's consistent backup API, verifies integrity, and refuses
to overwrite an existing destination. To restore, stop the service, set its
`BSTAE_DB_PATH` to the verified checkpoint on persistent storage, and restart.
Backups include knowledge and workspace data; they are not exposed by the HTTP API.
A restart test verifies that a backed-up plan can be reused and reverified.

## Executable behavior library

`behavior_library.py` registers eleven versioned behavior contracts in SQLite.
Each stores input/output types, effect, bounds, verifier, provenance, and an
implementation reference. Execution selects the exact operation and checks its
input type and parameters; stored data cannot introduce executable Python code.
Canonical specification hashes detect corruption and invalidate request plans
when behavior definitions change. Implementations remain installed Python code,
so exporting a descriptor alone is not a standalone executable.

Supported requests, composed with `then`:

- `multiply by N`, `divide exactly by N` (int64; division requires zero remainder)
- `uppercase`, `lowercase`, `trim`, `replace "old" with "new"`
- `count characters` (Unicode code points, not grapheme clusters)
- `sort ascending`, `sort descending`, `sum values`, `count values`

Numeric series accept 1..512 int64 entries. Sorting verifies order and multiset
preservation; arithmetic checks range and identities; text behaviors validate
bounded output and operation properties. The independently supplied final goal
is still mandatory. `behavior_inventory` lists stored contracts in the app.
Examples: `multiply by 3 then add 2`, input `4`, goal `14`; or
`sort ascending then sum values then multiply by 2`, input `[3,-2,3]`, goal `8`.
Type-changing plans are preflighted and then executed with matching state hashes.
Tests cover new compositions, memory reuse with zero LLM calls, Unicode, invalid
input types, overflow, division conditions, corruption and rejected goals.
This expands a bounded behavior library; it does not demonstrate general AI.

## Goal-directed planning milestone

`goal_execute` accepts `value` and `goal`, with optional explicit `candidates`
and `max_depth` (default 4, max 8), `max_nodes` and `max_frontier` (default 128,
max 512). It performs breadth-first search across applicable installed behaviors,
checks every transition, deduplicates typed states, executes the selected plan,
and independently checks the resulting goal before storing a hash-checked plan.
Reused plans are re-executed and reverified. No Gemini/model calls are made.

Supported contracts:

- `{"all":["trimmed","uppercase"]}` preserves text under only those transforms.
- `{"all":["sorted_ascending"]}` checks order AND preserves the original multiset.
- Other properties: `lowercase`, `sorted_descending`, `sum_of_input`, `count_of_input`.
- `{"equals":8}` retains exact-result goals for experiments/tests.

Parameterized behavior candidates must be provided explicitly; parameters are
not guessed. Example: input `[3,-2,3]`, goal `{"equals":8}`, candidates
`[{"operation":"multiply","amount":2}]` discovers sum -> multiply.
Text cleaning input `"  hello world  "` with trim+uppercase properties discovers
a two-step plan without an expected answer or supplied step sequence.

`fulfilled` means verified under this goal contract; `bounded` means a search
budget stopped exploration; `unsolved` means the permitted state graph was
exhausted. Neither failure proves there is no solution outside the given library.
Conflicting/unsupported predicates require clarification. The app includes a
“Plan from a goal” panel with text-cleaning and sorting examples.
This is bounded planning and compositional reuse, not training, open-ended
language understanding, or evidence of universal intelligence.
