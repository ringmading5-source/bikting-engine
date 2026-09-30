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

## Connected web lookup

The app now has **Look up on web**, separate from **Transform bytes**. Enter a topic such as `ball`, keep the optional URL blank, and look it up. `web_knowledge.py` uses Wikipedia's public MediaWiki API to search for up to three article introductions, then stores their text in binary source memory. No LLM API or additional search key is used.

Enter a public page URL to use the existing robots-aware page scraper instead. The hosted fetch adapter permits only public DNS destinations and standard HTTP(S) ports, refuses redirects, and retains byte limits and timeouts. Pages requiring JavaScript, a login, or denying robots access are unsupported. Failed retrieval returns an explicit error; it does not invent content.

The interface displays article/page titles, source URLs, excerpts, retrieval timestamps and byte previews. Wikipedia topic queries cache their source references for one hour in the local database. Cache results are labeled. Free Render restarts can still clear this SQLite state.

This adds retrieval and source-backed information, not an automatic semantic object model. A scraped description of a ball is evidence; it is not promoted into physics, rendering or executable interaction rules. Existing learned relationships remain distinct. The English Wikipedia provider can return multiple possible meanings and is not a general whole-web search engine. Specific URLs can retrieve other supported sources.

Validation: 116 tests pass, including API-response ingestion, binary evidence, cache reuse, HTML extraction, private-destination rejection, bounded queries and explicit network failure. External API tests use fixtures; live retrieval still needs checking from the deployed Render service.

Primary API reference: https://www.mediawiki.org/wiki/API:Query and https://www.mediawiki.org/wiki/Extension:TextExtracts .

## Behavior-sequence extraction

`sequences.py` implements time-ordered, event-conditioned behavior extraction. In the app, choose **Learn position sequence example**, then **Predict next behavior state**. The example learns from positions 0 → 2 → 4, checks a held-out 20 → 22 transition, and predicts 100 → 102 under the same event and one-unit duration. It does not infer the concept of a ball from the word `ball`; the observations supply a represented position trajectory.

Sequence source structure:

```json
{
  "training_sequences": [{
    "frames": [
      {"time":0,"entities":{"1":{"position":[0,0,0]}}},
      {"time":1,"entities":{"1":{"position":[2,0,0]}}},
      {"time":2,"entities":{"1":{"position":[4,0,0]}}}
    ],
    "events": [{"name":"advance"},{"name":"advance"}]
  }],
  "validation_sequences": [{
    "frames": [
      {"time":0,"entities":{"1":{"position":[20,0,0]}}},
      {"time":1,"entities":{"1":{"position":[22,0,0]}}}
    ],
    "events": [{"name":"advance"}]
  }]
}
```

The extractor recognizes each frame's ordinary values, requires stable entity IDs/types within observations, enforces strictly increasing timestamps, and requires one event between consecutive frames. It adds `duration` from the frame interval (rejecting contradictory supplied durations). Group one exact event/context descriptor per model. Training requires two distinct entry states; validation entries must be held out. Events are canonical byte records with a reserved ID, retained as guards on the learned relationship rather than merely displayed labels.

The report includes frame times, sequence indices, event context, payload lengths, common byte prefixes/suffixes and changed byte spans. A candidate must reproduce every training and validation transition before its relationship, report and source hash are stored. The event-labelled change is observational evidence, not proof of causation. Model prediction requires the same event/context/duration, binds compatible participants, abstains on ambiguity or budget exhaustion, and verifies the resulting bytes.

New recognized structured values: `{"position":[x,y,z]}` with signed integer coordinates and `{"audio":{"samples":[...],"sample_rate":8000}}` for bounded PCM16 data. Audio sequence events must retain matching `sample_rate`. Position units are adapter-defined. Sequence predictions do not infer physical units or dynamics from pixels or speech descriptions.

In addition to copy/insert/permutation/XOR, the byte-rewrite kernel now supports checked little-endian word deltas on fixed-width segments. The learner can infer constant deltas for known numeric layouts (integer, position coordinates, PCM samples and RGB channels), after trying simpler copy/reorder hypotheses. Word overflow is rejected. Existing BRLT descriptors stay compatible; delta fragments carry extra numeric fields. This extends the explicit machine hypothesis class; it is not arbitrary program induction or a new physical law.

CLI:

```sh
python main.py file examples/position-sequences.json
python main.py learn-sequences 1 600
python main.py behavior '{"25":{"position":[100,0,0]}}' '{"name":"advance","duration":1}'
```

Use the actual returned source ID. Structured JSON sources can also be fetched through `main.py web URL` before learning; prose webpages are not automatically converted into behavior traces. Separate event groups must be learned as separate models. This version does not track entities from unstructured video or learn arbitrary nonlinear dynamics.

Validation: 128 tests pass, including ordered frame extraction, text/color/audio/position sequences, changed-span reporting, event/time conditioning, malformed/different schemas, validation failure non-promotion, word-delta serialization, model persistence, app prediction and real authenticated HTTP sequence routes.

### Image states and automatic pixel-program memory

The Image bytes in memory panel decodes uploaded images in the browser, composites transparency over white, and reduces them to at most 64 × 64 pixels. Packed RGB bytes and dimensions are sent to the engine. Supply two before/after training pairs and one held-out validation pair; receiving all six images triggers extraction, validation and storage automatically, without an approval step.

`engine.images.observe({"training": [...], "validation": [...]})` returns a content-addressed model. Each pair has `before` and `after` images with `width`, `height`, `rgb_hex`. The program is inferred from pixel states using the existing byte-fragment engine; every supplied output pixel must match exactly. Validation requires a separate image and at least one unseen pixel input. Duplicate sources reuse the model. The database retains supplied observation bytes, program bytes, hashes and validation report.

`engine.images.transform(image, model)` executes that stored program independently on every pixel. The browser renders returned pixel bytes as the resulting image. Dimension mismatch, invalid bytes, guard failure, corrupted program or arithmetic overflow rejects the operation. API actions are `image_observe` and `image_transform`.

Scope: uniform RGB channel permutations, fixed channel arithmetic or XOR supported by the bounded inference class. This does not learn spatial motion, object identity, arbitrary image edits or behavior from prose. Held-out checks support a hypothesis; they do not prove all unseen outputs correct. Models persist with SQLite; the browser's current model selection lasts for the page session. Image previews and uploads have not received live browser QA; Python routes, persistence and program rejection behavior are covered by tests.

### Automatic memory for other input modalities

`engine.modalities` extends the image observation workflow to UTF-8 text, signed INT64 integers, RGB colors, POSITION3 coordinates and mono PCM16 audio. Ordinary JSON values are recognized through the existing adapters. The app's **Other modalities in memory** panel automatically extracts, validates and stores a program when an observation file arrives or valid edited observations are submitted after a short input debounce. Choosing an example immediately runs the same process on explicitly synthetic fixtures. No acceptance step is required for learning.

Observation sources contain `training` and `validation` arrays of `{before, after}` values (not participant maps). At least two distinct training inputs and disjoint validation input states are required. All observations must retain the same representation and format context. Every observed output must be reproduced before atomic promotion. Supported hypotheses remain copy/insert, block reorder, fixed typed word deltas and XOR; arbitrary semantics or program synthesis are not implemented.

API: `modality_observe` accepts `observations`; `modality_models` lists persisted reports; `modality_transform` accepts `value` and `model`. Programs are content-addressed, integrity-checked and retain the supplied observation source plus format context. The explicit model selection prevents unrelated rules from silently competing. Inputs are bounded to 16384 payload bytes and each split to 20 pairs. Numeric overflow, unsupported bytes, guard failures and format mismatch reject execution.

The app displays decoded outputs and before/after byte previews; colors include swatches. Audio includes playable WAV output. A mono PCM16 WAV upload can populate the current audio value without resampling; observations can be supplied as JSON sample arrays. Sample rate and channel count are binding context, not guessed from sample bytes. This is sample transformation, not transcription, speech understanding or unrestricted voice generation. Coordinate units remain adapter-defined. Text transformations are structural byte operations, not language comprehension.

Stored programs can be reloaded after a page refresh using **Load stored programs**, provided the SQLite database survives. Validation: 140 Python tests pass, including every supported modality, held-out failure, context mismatch, overflow, provenance persistence, program corruption, audio rendering and application routes. Browser script syntax is checked; live graphical/audio browser QA remains pending.

### Intent boundaries and automatic path selection

`intent_engine.py` connects supported requests to byte execution without manual model selection. The **Intent to byte execution** panel accepts ordinary JSON input and a command: `add N`, `append "text"`, `brighten N`, `move by X,Y,Z`, or `shift samples by N`. Structured intents are also accepted (`operation` plus `amount`, `text` or `delta`). These are explicit grammar adapters, not arbitrary natural-language comprehension or a next-token model.

The adapter recognizes the entry representation, derives an exact target independently of retrieved programs, and retains format context, checked arithmetic and depth constraints. Bounded breadth-first search over up to 100 context-compatible stored modality programs can compose paths of up to five transitions. If search finds no path within bounds, an explicit registered byte operation executes the supported intent directly; this fallback is identified in the result. No dataset is required for those registered operations. Unsupported or underspecified commands fail with supported syntax rather than guessing.

Every step executes through guarded byte fragments. Full target-byte equality is required before path persistence. Boundary fingerprints include complete entry/target states, intent, format context, depth and candidate program definitions. Cached programs are re-executed and compared before reuse. Output includes the boundary, program sequence, result and source (`memory_search`, `persistent_memory`, or `registered_operation`). API action `intent_execute` accepts `value`, `intent` and optional `max_depth`.

Image action `image_intent` accepts `image` and explicit `brighten N`. Brightness here means adding the same signed integer to each RGB channel, preserving dimensions; it is not a perceptual luminance model. It checks stored image programs against the exact target before falling back to a registered pixel program. Channel overflow rejects the image instead of clipping. Image path composition and image boundary persistence are not implemented in this version.

Validation: 147 tests pass, covering no-dataset operation across all supported modalities, memory composition, depth fallback, incompatible intent rejection, overflow, image target verification, structured API requests and corrupted-cache revalidation. Browser script syntax is checked; graphical browser QA remains pending.

### Recursive sequence-to-sequence intent core

`recursive_sequences.py` implements the sequence direction: recognized typed payload bytes are indexed by format context, byte count, first byte and last byte. The SQL index generates candidates only. Full payload equality is mandatory before accepting a relationship. A relationship expands a sequence into ordered child sequences or grounds it in an explicit structured machine operation. Children use the same resolver recursively. When there is no full relationship, the resolver searches for a unique ordered covering of registered subsequences, then recursively expands those spans.

`engine.recursion.register(value, children=[...])` stores a recursive expansion; `register(value, intent={...})` grounds a terminal. `resolve(value)` returns an ordered operation sequence and index/full-match trace. `execute(sequence, current_value)` first resolves, preflights all typed targets, then uses the existing transition engine to execute each operation and verify exact target bytes. The terminal path calls structured operations, not the English command grammar. Numeric, text, color, coordinate and audio values may serve as sequence keys; format context distinguishes identical audio payloads at different sample rates. Payload byte length is not a character/token count.

Conflicting full definitions and multiple subsequence coverings abstain as ambiguous. Unknown sequences remain unknown. Active recursion cycles, depth, node, action, candidate and span budgets stop resolution. This is a deterministic, bounded search over supplied grounded relationships; endpoint signatures alone do not identify meaning, and this release does not automatically discover arbitrary concept relationships or tool semantics. No unconditional midpoint splitting or nearest-byte meaning is assumed. Definitions persist in SQLite; they are trusted operator-supplied memory.

App: **Recursive byte-sequence intent**, with registration, resolution and execution controls. The explicit synthetic example expands `increase-eight` into two `increase-four` sequences, each into two `step-two` sequences; each terminal executes the structured add-two operation. Starting at 100 produces 108 after four checked transitions. Names are example keys, not built-in English understanding. This resolver is accessible separately from the earlier command panel.

API actions: `recursive_register` (sequence plus children or intent), `recursive_resolve` (sequence), `recursive_execute` (sequence and value), `recursive_demo` (optional numeric value). Graphing/tool capability terminals remain future adapters; this implementation connects to existing numeric/text/color/position/audio byte operations.

Validation: 157 tests pass, including nested expansion, full-match rejection of identical endpoints and length, ordered subsequence composition, conflicting paths, cycles, budgets, numeric/audio keys, preflight overflow without path promotion, application execution, idempotency and persistence. Browser syntax checked; live graphical QA pending.

### Word-first coherence and stabilization

`word_sequences.py` adds a word-level adapter before recursive intent execution. Input text is split on whitespace into 1..64 ordered words, retaining each exact UTF-8 byte sequence. The word index uses word count, first word bytes and last word bytes; complete packed word sequence equality is required. Case and punctuation are preserved, repeated whitespace is normalized, and subsequence covering operates only at word boundaries. This is not universal language tokenization: languages without whitespace need additional segmentation adapters.

`engine.words.register(text, children=[...])` supplies recursive word-sequence relationships; `register(text, intent={...})` grounds terminals in structured operations. `resolve(text, current_value)` refines the ordered sequence in bounded rounds. A stable result requires a full terminal fixed point and successful preflight of every ordered operation on the recognized current value, preserving the typed operation constraints. Unknown words, conflicting exact definitions, ambiguous word coverings, ungrounded unchanged sequences, cycles, overflows and exhausted budgets prevent stabilization. Coherence here is executable type/target consistency, not proof of semantic truth or the human's intended meaning.

`execute(text, value)` executes only the stabilized plan through existing transition memory, with exact final target verification. Stabilized reports persist with the original word bytes, entry state and a fingerprint including relationship definitions. Relationships are still explicitly supplied; the engine does not infer arbitrary meanings from the endpoint index. The old byte resolver and command adapter remain available.

App: **Word sequences and stabilization**. The synthetic example resolves `increase four times` into two `increase twice` child sequences, then four `increase` words, then four grounded add-two operations. One unchanged terminal round confirms the fixed point; coherent execution on 100 returns 108. The trace exposes word bytes, every refinement round, target chain and execution. Example meanings are deliberately registered rather than presented as automatically learned English.

API actions: `word_register` (text plus children or intent), `word_resolve` (text and value), `word_execute` (text and value), `word_demo` (optional numeric value). Bounds are available on the Python resolver. Validation: 167 tests pass, covering word boundaries, Unicode byte preservation, ordered spanning, endpoint collisions, conflicts, cycles, ungrounded fixed points, budgets, incoherent targets, persistence and app execution. Browser script syntax checked; live visual QA pending.

### Bounded automatic web intent discovery

`web_intent_loop.py` adds a persistent search-and-retry queue around word stabilization. Each step resolves the current task; if grounded it executes the verified plan and advances to the next task. Unknown tasks trigger a topic/subsequence/word search through the existing Wikipedia lookup or supplied public source URLs. Sources enter binary knowledge memory. Search attempts, errors, imported sources, task position and results persist in SQLite. Each task independently uses the same provided execution input, not the previous task's result.

A compatible JSON source has `word_relationships`: entries containing `text`, either structured `intent` or `children`, plus `training` and `validation` arrays of ordinary `{before,after}` values. The importer registers the entire collection atomically only if every relationship stabilizes and reproduces at least two distinct training inputs and a held-out validation input with consistent format context. Failed imports roll back all definitions. Provenance retains source ID, content hash and imported definitions. Operations are restricted to the existing structured byte capabilities; webpage instructions cannot introduce code execution or new external tool actions. Observations validate consistency, not source authenticity or universal meaning.

Ordinary prose remains evidence only. The default Wikipedia extracts generally do not contain this structured schema, so they do not automatically become word meanings. The loop cannot promise to resolve any arbitrary intent through repeated searches. Conflicts and incoherence block execution; search exhaustion stops as `needs_grounding`, preserving the unresolved task and evidence. Limits are 1..5 searches per task and at most 64 tasks. Resume retries after memory/source updates. No task is skipped silently when intent is unmet.

App **Web discovery → stabilized intent** starts the automatic client-driven loop, with alphabetical queue order and an optional A–Z letter-query fill button. Letters are discovery queries, not predefined executable intents; an ungrounded letter stops the queue. Jobs survive page reload if SQLite survives; paste the job ID and Resume. This is not an always-running server crawler: steps run while the page is open, or via an API client. Stop takes effect after the in-flight bounded request finishes. The local server handles requests serially.

API: `discovery_start` (texts, value, optional URLs/search budget/alphabetical), `discovery_step`, `discovery_status`, `discovery_stop`, `discovery_resume` (job ID). The default provider remains Wikipedia, not a general internet search engine. Live provider access depends on the deployment network.

Validation: 172 tests pass, including search→validated import→execute→next task, prose-only exhaustion, invalid-source atomic rollback, alphabetical order, ambiguity blocking, resume/stop and network failure. Tests use source/network fixtures; browser syntax checked, live graphical and external-network QA pending.

### Installed HTML scraping tool

Beautiful Soup 4.14.3 is now installed and pinned in `requirements.txt`. Run `python -m pip install -r requirements.txt` before starting/testing locally. Render's Blueprint build installs requirements before tests; existing dashboard services using only the test command must update their Build Command accordingly.

`soup_scraper.py` uses Beautiful Soup on the existing bounded public HTTP fetcher. It extracts main/article text, removes common hidden/navigation material, retains page titles, collects embedded `<script type="application/json">` objects with the exact `word_relationships` schema, and exposes up to five same-site JSON links. The discovery loop automatically ingests embedded sources and can follow discovered JSON links within its existing attempt budget. Robots restrictions, timeouts, public-address checks and byte bounds remain in the HTTP adapter. No page scripts are executed.

The scraper does not turn ordinary prose into executable semantics. Structured definitions still require held-out observation validation before registration. JavaScript-rendered pages are not supported. Queue stepping is still client/API-driven, not a permanent background service. Validation: 175 tests pass, including visible-content extraction, restricted link selection, embedded-schema ingestion through the loop to verified execution, and malformed JSON rejection.

### Source definitions to executable geometry

`concept_grounding.py` implements a small deterministic prose-grounding adapter, connected to discovery after word resolution remains unknown. Explicit `draw/show/render [a/an/the] SUBJECT` requests search the subject rather than the whole command. Source text is scanned for an affirmative definition of that exact subject (`A ball is a round object ...`). Supported shape adjectives before an explicit category become source-backed property descriptors, retained as canonical bytes with the source ID/hash and original clause. Unrelated subjects, unsupported categories and negative/uncertain clauses are rejected.

The registered `render.2d.geometry` capability converts supported descriptors into an illustrative SVG circle, ellipse, square, rectangle or triangle. The engine checks canonical output, primitive type and coordinate bounds before returning a verified geometry result. Multiple conflicting shape descriptors abstain. Source changes invalidate old properties. Evidence is linked in the interface. This establishes a limited real prose→property→capability→output path; no external LLM or supplied word-relationship JSON is required for these supported definitions.

Example: enter `draw ball` in the discovery queue. Wikipedia's definition of a ball as a round object can support a circular 2D depiction. The result is explicitly illustrative: it does not infer texture, size, material, movement or a photorealistic model. Parenthetical qualifications remain in the evidence; the base round-object clause supports a generic circle, not proof that every ball has that exact shape. The source statement is not independently verified. Other verbs/concepts and arbitrary prose remain unsupported. This adapter supplements, rather than replaces, recursive word memory.

Validation: 181 tests pass, including unstructured definition retrieval through the discovery loop to completed geometric output without word fixtures, incorrect/negative subjects, conflicting sources, SVG bounds/type checks and stale-source rejection. Browser syntax checked. Live deployment verification is tracked separately from fixture tests.

### Broader byte-backed source relationships

`relationship_extraction.py` adds deterministic extraction for exact English subjects in affirmative definitions (`X is a/an Y`), contents (`X contains Y`), integer counts (`X has N items`) and conversion statements (`X converts A into B`). These are bounded pattern families, not general NLP. `inspect X` or `describe X` in discovery searches X, extracts matching clauses, stores relationship descriptors as canonical BLOB states, and returns source-linked inspection results. Bare subjects do not imply a rendering/action request.

Each descriptor retains source ID/hash, the exact character span and original clause, predicate, typed object (counts as integers), qualification status and scope. Loading verifies source hash, canonical state integrity and span equality. Qualified source text stays qualified. Different counts for the same item are flagged; arbitrary contradictions are not automatically solved. Source changes invalidate earlier relations. These records are source claims, not truth certification, causal laws or unrestricted executable transitions.

Extraction automatically runs after supported web lookup. Graphical drawing remains restricted to the separately registered geometry capability. Extracting `converts nutrients into energy` does not grant a tool capable of executing that biological process. Inspection results show relation memory; they do not pretend to execute observed real-world behavior. Further capability grounding remains required for other action requests.

Validation: 188 tests pass, including all four predicate families, exact span evidence, qualified definitions, count conflicts, subject precision, memory integrity, invalidation, idempotence and search→source→relation inspection without word fixtures. The preceding `draw ball` path was also verified on the real Render deployment after release: live Wikipedia retrieval led to a completed job and verified SVG output. The new broader extraction release still requires its own live deployment check.

### Property-selected computational graph capability

`capabilities.py` registers computational adapters with input type, output type, effect, styles, version and executor. Matching uses those properties; provider names do not determine suitability. Duplicate IDs and multiple compatible providers fail rather than selecting silently. Matplotlib 3.10.8 is pinned in requirements and supplies the first plotting adapter.

Built-in word relationships ground `graph these values` / `line graph` through `plot ordered values` and `bar chart` through `plot ordered bars`. Recursive refinement reaches a structured `plot_values` terminal, checks numeric input and capability requirements, stabilizes, then executes. These are explicit registered language mappings, not automatically acquired meanings. Mixed plotting/arithmetic recursive plans are currently rejected; numeric-series state conversion to other capability inputs is unfinished.

Numeric lists contain 1..256 finite integers/floats within ±1e12. A registered BNS1 byte adapter encodes a uint16 little-endian count followed by float64 little-endian values inside a BLOB state. Element positions become x coordinates; supplied numbers become y coordinates. This adapter supplies the schema explicitly instead of guessing meaning from raw bytes. The Figure adapter verifies line x/y data or bar centers/heights against the input, then saves SVG and checks its root/viewBox and absence of script nodes. Verification confirms plot data faithfully reaches the plotting objects; it is not independent proof of every rendered pixel or the data's truth.

Full input bytes, target specification, capability identity/version and Matplotlib version define the persistent boundary. Every reuse reruns the provider and verifier. Matching output hashes permit reinforcement; changed/corrupted memory does not bypass checks. The adapter performs no arbitrary code execution, path writes, remote provider calls or credential handling. SVG output is bounded to 500 KB and figures are cleared after use.

App **Computational graph capability** accepts a supported request and a numeric JSON array, then displays the graph and the recursive/byte execution trace. Bare `graph`, `chart` or `plot` in the direct capability API asks for a style; it does not choose a network-graph meaning. API `word_execute` accepts text and numeric-series value, `capability_execute` accepts request/values/optional title, and `capability_inventory` lists properties. The older discovery queue's value adapter still expects its documented single-modality inputs, so numeric-series plotting uses the computational panel or word API.

Validation: 196 tests pass, including recursive plotting, exact coordinate mapping, bar heights, finite/bounded data, duplicate/ambiguous adapters, different input boundaries, deterministic SVG output, reverified persistent reuse, app routes and failed-verifier non-promotion. Browser script syntax checked; this new plotting release requires live deployment verification. Prior web-to-geometry live verification remains separate.

Matplotlib API reference: https://matplotlib.org/stable/api/figure_api.html .
