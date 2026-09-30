# B-STAE deterministic byte-interaction prototype

A working local prototype of recognized inputs, typed binary states, stored byte relationships, bounded transition composition, verified execution and decoded outputs. Python 3.10+, standard library only. No LLM calls.

## Start here

Extract the package, open a terminal in `b-stae`, then run:

```sh
python app.py
```

Open http://127.0.0.1:8765 in your browser. Click **Load example observations**, then try text `New` or color `#102030`. The app displays the predicted output and participating bytes. You can enter training/validation observations and accept or reject a displayed result. Records persist in `knowledge.sqlite3` beside the code; keep that database to retain memory. Stop the server with Ctrl+C.

Optional terminal session:

```sh
python main.py session
```

At the prompt:

```text
learn file examples/byte-relationships.json
interact {"20":1,"30":"#000000","40":"Ready"} -> {"20":1,"30":"#ff0000","40":"Ready!"}
rules
quit
```

The example defines numeric-control → color and color → text interactions. B-STAE recognizes the ordinary input values, binds stored roles to compatible participants, composes a two-relationship path and prints decoded states alongside participant bytes. Repeat the interaction to retrieve and reverify its persistent path.

You supply ordinary values and a desired outcome, not manually encoded input bytes. The supplied example relationships are explicit definitions, not discoveries from arbitrary text. Entity IDs identify objects; changing their IDs does not prevent compatible relationship binding.

Other demos:

```sh
python relationship_demo.py
python byte_demo.py
python persistent_demo.py
python -m unittest discover -s tests -v
```

Open `byte-demo.html` for a visual replay of generated binary-execution snapshots, including numbers, RGB color, text, object position and synthetic audio. It replays Python-generated snapshots rather than running a second engine. Audio processing is not speech synthesis.

## Architecture

Ordinary input → representation recognition → typed byte state → matching relationship guards → bounded path composition → byte transformations → exact-target verification → decoded output and persistent path memory.

| File | Role |
|---|---|
| `main.py`, `session.py` | Main CLI and interactive entry point |
| `engine.py` | Main engine integrating recognition, sources and persistent memory |
| `core.py` | Binary records, byte arena, typed opcodes and deterministic execution |
| `byte_relationships.py` | Guarded representation-independent byte relationships |
| `bound_relationships.py` | Participant binding, composition and persistent verified paths |
| `relationship_sources.py` | Structured source import, observed-fixture checks and provenance |
| `recognition.py`, `output.py` | Input recognition and output rendering |
| `knowledge.py` | Web/file source ingestion and keyword retrieval adapter |
| `path_memory.py` | Persistent typed-opcode programs |

## Representations

| Type | Byte payload |
|---|---|
| int64 | Eight signed little-endian integer bytes |
| UTF-8 | Valid UTF-8 text bytes |
| RGB | Three color-channel bytes |
| PCM16 | Signed little-endian 16-bit audio samples |
| Position | Three signed little-endian 32-bit coordinates |
| Opaque binary | Arbitrary bytes without a claim of semantic understanding |

State wire format: BSTA magic, version, record count, then sorted records carrying entity ID, type ID, payload length and bytes. Strict decoding checks type/length, UTF-8, bounds, entity uniqueness and canonical ordering. State size is capped at one million bytes.

Automatic recognition supports Python integers/text, CSS #RRGGBB strings, UTF-8 text files, mono uncompressed PCM16 WAV, binary P6 PPM and BSTA files. File signatures take precedence over extensions. PNG/JPEG/GIF/PDF families are detected but their decoders are not implemented. Floats, booleans, arbitrary raw bytes, stereo/compressed audio and video are not inferred. Position/opaque records currently require typed adapters. Unknown raw bytes remain ambiguous.

Sample rate and image dimensions remain adapter metadata. `Engine.transform` rejects unsupported metadata changes. `Engine.interact` currently combines recognized byte records, not metadata constraints; use it for schemas whose relationship assumptions are explicitly valid. Multi-record images need non-overlapping entity ranges.

## Byte relationships

Each stored relationship has an integer ID, participant guards and simultaneous effects. Guards match representation type, optional payload length, and an offset signature under a relevance mask. Effects concatenate fragments:

- COPY a guarded participant's byte segment.
- INSERT explicitly stored bytes.
- XOR a copied segment with a same-length mask.

All effects read the original state. Output records are validated before the new state is accepted. The same primitives support text insertion, channel/sample rearrangement, opaque transformations, cross-type controls and layout-compatible field transfer. Untouched records remain intact.

Relationships use a BRLT binary header around a canonical JSON descriptor containing hex byte fields. This is a serialized data program, not native machine-code dispatch. The existing typed opcodes (ADD, APPEND, COLOR_SHIFT, GAIN and TRANSLATE) remain available separately; they are not required by the generic rewrite kernel.

Participant binding enumerates compatible records in deterministic entity order, requires distinct participants and applies bounded search. Binding supports effects on guarded roles; creation of new entities requires an allocation policy and is currently supported only by the fixed-role resolver. Larger searches can fail because of bounds even if some theoretical path exists.

## Source ingestion and relationship import

```sh
python main.py file examples/byte-relationships.json
python main.py import-relations 1
python main.py web https://www.python.org/about/
python main.py recognize 42
python main.py recognize '#ff0080'
python main.py memory
```

Use `--db PATH` before a subcommand. `memory` reports typed-opcode path statistics; `session`'s `rules` command reports interaction definitions and imported provenance. Source IDs are returned by ingestion; substitute the actual ID when importing.

Structured JSON sources use `byte_relationships`, an array of entries with `definition` and `observations`. Definitions contain the relationship descriptor. Each observation contains canonical BSTA `before` and `after` hex states. Import validates the whole collection and requires every rule to reproduce every supplied fixture before an atomic registration. Provenance retains source ID, source hash and observation count. Re-importing the same definition from the same content hash is idempotent; ID conflicts are rejected.

These fixtures are supplied evidence, not independently authenticated observations or proof of universal validity. Imports do not discover new relationships or infer rules from arbitrary prose. The example source was authored as a demonstration fixture.

Web retrieval checks robots.txt, refuses redirects, sets timeouts and limits both fetched and gzip-decoded content. It supports HTML, text and JSON without executing JavaScript. It does not crawl automatically. Keep it a trusted local CLI: private-network destinations are not restricted. Local TXT/Markdown/HTML/JSON/CSV sources are supported.

Source text is encoded into typed binary source states with URI, hash, ID and title. Source collections can be migrated with `python main.py migrate`. Binary source blobs persist with integrity checks. Derived states preserve the original source. Oversized sources may remain in the source collection but cannot fit the binary schema; chunking remains unfinished.

## Verification and persistence

A successful path is re-executed and compared against the full target bytes before promotion. Persistent keys retain complete entry/target states, definitions and permission/depth context. First/last sequences and lengths are hints, not sufficient identity. On reuse, all guards and outcomes are reverified. Corrupted relationship definitions fail closed; invalid cached paths are rejected. SQLite retains source representations, definitions, provenance and verified paths across restarts.

Hashes detect accidental corruption, not an authenticated adversary. The local database and registered schemas are trusted. Total database growth and the runtime byte arena are not automatically evicted. Python performs the work; there is no constant-time, native-dispatch or hardware-performance claim.

## Saved output workflows

```sh
python run.py 3 7 --add 2 --depth 2 --output answer.json
python run.py '#000000' '#0a0000' --shift 10 0 0 --output color.txt
python run.py Hi 'Hi!' --append '!' --output message.txt
```

`run.py` takes ordinary input/target values or files and an explicit registered operation. It renders only verified results. Supported output formats are numeric JSON, text, CSS hex text, WAV, PPM and BSTA. Generic JSON file recognition treats files as text; numeric JSON values in the CLI/API are recognized as numbers. Existing output paths are overwritten on success. Image operations are currently per pixel, so practical image searches are bounded.

`ask.py` and `intent_bridge.py` remain optional source-defined phrase recipes. They can infer a target only for explicitly supplied matching phrases; they are not the relationship kernel. The original English relationship implementation is preserved as optional `legacy_core.py`, `legacy_demo.py`, `relationships.py` and `request_parser.py`. `binary_core.py` is a compatibility import of `core.py`.

## Validation and scope

95 tests pass, including binary formats, type/overflow rejection, ordinary input recognition, image/audio roundtrips, saved output, source persistence, guarded multi-type interactions, simultaneous effects, participant binding across IDs, source-fixture rejection, permission/depth bounds, persistent reuse and the complete interactive import-to-output chain.

The supported prototype is complete and runnable locally. It is not a universal autonomous AI or production release. Targets and valid relationships still need to be supplied. Automatic discovery from arbitrary web content, inference of unseen goals, learned operation synthesis, general multimodal semantics, all-format decoding, live voice generation, high-performance indexing and integration with the external Bikting repository remain unfinished. Observable bytes and format validation alone do not establish meaning or factual truth.

## Bounded learning from observations and automatic outcomes

`learning.py` now infers supported byte relationships from supplied before/after examples, without a supplied relationship definition or an LLM. This implements a limited learning layer, superseding the earlier statement that all relationships must be supplied as definitions.

In a fresh database/session:

```sh
python main.py --db learned.sqlite3 session
```

Then:

```text
observe examples/observations.json 200
observe examples/color-observations.json 201
predict {"25":"New"}
predict {"40":"#102030"}
```

The first source supplies observations Hi → Hi!, Hello → Hello!, with separate validation Hey → Hey!. It does not supply an append rule. The learner infers copying input bytes and inserting a shared suffix, validates that hypothesis, stores it with source provenance, and predicts New → New! without a target supplied at prediction time.

The second source supplies RGB before/after examples. The learner infers a byte-channel permutation and predicts #102030 → #302010. These example observations are synthetic local fixtures, not independent evidence about the external world.

Observation JSON has separate `training` and `validation` arrays. Each entry has `before` and `after`, either ordinary participant maps or canonical BSTA hex. Ordinary values are recognized automatically. At least two distinct training input states and one held-out validation input are required. Schemas must be stable. Every inferred rule must reproduce all training and validation targets before registration. A failed hypothesis is not promoted.

The hypothesis class is deliberately finite: unchanged byte copies, invariant literals under exact-input guards, shared prefix/suffix insertion, fixed block rearrangement and fixed XOR masks. It does not infer arbitrary programs, arithmetic formulas, semantic relations or unseen modalities. Enumeration and input sizes are bounded. Candidate selection is deterministic and chooses one fitting hypothesis; passing a held-out example does not eliminate all other explanations or prove correctness outside the observations.

Prediction applies permitted stored relationships through participant binding. It emits a target only if exhaustive binding within its configured budget yields one distinct changed state. No match yields unknown; multiple outcomes yield ambiguity; too many potential bindings yields bounded abstention. It verifies the chosen transition and uses persistent path memory. Prediction currently makes one transition, not autonomous goal planning, and uniqueness does not establish what the user intends. Imported explicit relationships and learned relationships both participate unless permissions restrict the IDs.

Learning provenance is stored in `learned_relationships` with source hash, training count, validation count and inferred hypothesis names. Explicit import provenance remains in its own table. The schema can be acquired from a connected source via `main.py web` followed by `main.py learn-observations SOURCE_ID RELATIONSHIP_ID`. Arbitrary prose webpages do not supply trustworthy observations automatically; their conversion into evidence is still unfinished.

Validation: 104 tests pass, including unseen-input application, inferred RGB permutation, held-out failure rejection, duplicate validation rejection, unsupported hypothesis rejection, conflicting predictions, permissions, normal-value observation import and abstention when binding cannot be fully enumerated. No universal autonomous intelligence or arbitrary-web understanding is claimed.


## Finished local app and final validation

`app.py` and `app.html` provide the main local interface. It binds only to loopback, checks Host/Origin on requests, serves one page and accepts a bounded JSON API. No accounts, external deployment or third-party packages are required. The page supports ordinary text, color and integer inputs, example learning, custom observation learning, prediction, byte traces and feedback. Underlying file/audio/image adapters remain available through the CLI/API.

Acceptance/rejection is persisted as outcome feedback tied to before/after states and the applied relationship evidence. It does not automatically retrain, certify or remove a rule. Pending feedback tokens last only for the current server process and are single-use. At most 100 pending results are retained. The database is local persistent memory; copying only the code archive does not copy previously accumulated memory.

Final validation: **108 tests pass**, and a loopback HTTP smoke test passed for page serving, learning the examples, predicting New → New!, and recording acceptance. Tests cover engine behavior and app endpoints; no full graphical-browser visual QA was performed. The server is stopped after smoke testing.

This finishes the supported local prototype. The project still does not implement universal autonomous understanding: inference is limited to the documented byte hypothesis class, goals can be ambiguous, and arbitrary prose web sources do not automatically become grounded observations. These are substantive missing research capabilities, not features claimed complete by this release.

## Deploy on Render

This folder is a standalone Python service. See [RENDER.md](RENDER.md) for the exact settings; choose Root Directory `b-stae` in the GitHub repository. `app.py` supports Render's PORT, public host binding, external hostname checks, `/health` and a shared `BSTAE_ACCESS_TOKEN`. Local operation remains token-free unless that environment variable is configured. Public binding requires a secret of at least 16 characters.

The deployment file is `b-stae/render.yaml`, distinct from the repository's existing Node service Blueprint. Free deployment has ephemeral SQLite memory. Persistent memory requires a disk and BSTAE_DB_PATH under its mount, as explained in RENDER.md. This is still a single-user prototype access gate, not user accounts or production authentication.

Render-preparation validation: 111 tests pass, including real HTTP health/page access through an external Host, token-gated prediction and cross-origin rejection. No credentials or runtime databases are included in Git.
