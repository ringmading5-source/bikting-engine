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

## Research milestone: bounded hypothesis learning

`behavior_learn` accepts at least three distinct `examples` input/output pairs,
one or more separate `validation` pairs and an evidence `source`. It infers
parameters only within installed templates: integer addition/multiplication,
text uppercase/lowercase/trim/append, and integer-series sorting/sum/count.
Exactly one hypothesis must fit the training set before held-out validation.
Ambiguity, unsupported patterns, shared train/validation inputs and contradictory
validation do not promote a hypothesis. This is small template induction, not
unrestricted behavior invention, statistical confidence estimation or neural training.

Saved evidence is hash-checked, version-bound and visible through
`behavior_hypotheses`. Active hypotheses become candidate actions for goal search;
they never bypass type checks, behavior verification or final goal verification.
Example: observations `1->2`, `2->4`, `3->6`, held-out `4->8`, support multiply by 2.
Search can then apply it to unseen input `7` with goal `14`, or compose series sum
and multiply on `[1,2,4]`. The latter demonstrates limited compositional transfer.
Finite examples do not establish correctness for every future input.

`behavior_feedback` accepts a hypothesis ID and observed input/output pair.
Feedback is recorded persistently; contradictory feedback disables the hypothesis
and changes planner candidates so prior goal-plan memory cannot reuse it.
Repeating the original evidence does not reactivate a rejected hypothesis.
The app includes training, validation, inspection and feedback controls.
No LLM calls are made by this learning subsystem. Open-ended perception,
new algorithm discovery, causal learning and universal intelligence remain research goals.

## Context-aware transition learning (research prototype)

`transition_learn` accepts 3..32 training `examples` and 1..16 separate
`validation` observations. Each observation includes named int64 `before` and
`after` state fields, an `action` label, explicit string `context`, relationship
triplets (`from`, `kind`, `to`), `outcome: "observed"`, and a `source` reference.
The subsystem learns a fieldwise affine hypothesis `after[field] = a*before[field]+b`
using exact rational arithmetic, then validates all training and held-out pairs.
Each field must vary in training. Contexts, actions, relationships and field schemas
must agree across observations; fit separate models for separate conditions.
Nonlinear or coupled-field patterns are outside this model class.

`transition_predict` requires a model ID, new `state`, `transition_action`, context
and relationships. The gate must match the recorded conditions exactly. Predictions
outside each field's observed training range require `allow_extrapolation: true`.
Fractional or overflowing state results reject. An inverse consistency check is
reported when the learned transition is invertible. It checks algebraic consistency,
not correctness in the real world. `verified_outcome` is always false for a prediction;
new observations are required to establish whether it occurred.

`transition_feedback` records a complete new observation. Contradictions disable
the hypothesis persistently; different contexts do not invalidate the original
context's model. Reusing original evidence never reactivates a disabled hypothesis.
Models and evidence survive SQLite checkpoints and are checked against content hashes.

The app's context-transition panel loads a synthetic inventory simulation. A
receive-five action changes stock and received totals. It predicts a withheld
state only under the same warehouse, batch and relationship conditions.
This is observational transition fitting, not causal discovery. Context and
relationships are supplied labels; the system does not discover their semantics.
No physical action or external tool is executed by this learner, and these models
are not automatically added to the task planner's executable behavior registry.
No LLM calls, neural training or universal intelligence claim is involved.

## Coupled-field learning and reproducible evaluation

`coupled_learn` accepts the same complete observations as `transition_learn`,
but learns `after = A * before + b` across named fields using exact rational
Gaussian elimination. Every next-state field can depend on all current fields.
Training must have sufficient independent variation to identify a unique model.
Correlated/underdetermined observations reject instead of arbitrarily choosing
coefficients. Inconsistent training and failed held-out checks reject.

`coupled_predict` and `coupled_feedback` retain exact action/context/relationship
gates, int64 output validation, explicit extrapolation, persistent evidence,
counterexample disabling and hash checks. Inverse consistency uses the full
matrix when invertible. Predictions are not observed outcomes or physical actions.
Different explicitly supplied contexts can have separate models; relevant context
conditions and relationship semantics are not automatically discovered.
Use the coupled panel's example: next stock depends on current stock PLUS incoming
units. This is a cross-field dependency the earlier fieldwise model cannot fit.

Run `python evaluation.py` or the app's “Run fixed synthetic evaluation” button.
The fixed benchmark uses seed 1729 and an isolated in-memory engine. It reports
individual cases and totals by category, with disjoint training, validation and
20 test states per simulated context (40 held-out predictions across two modes).
It also checks the fieldwise baseline's failure, context rejection, goal composition,
and nonlinear-pattern rejection. No fitting happens on the test states. The small
synthetic benchmark cannot establish natural-language understanding, perception,
causal discovery, unrestricted generalization or universal intelligence.

### Versioned training datasets

Run the offline dataset pipeline (no API key or LLM calls):

```bash
cd b-stae
python dataset.py examples/inventory-dataset.jsonl
# Preserve model evidence and evaluation reports in SQLite:
python dataset.py examples/inventory-dataset.jsonl --database dataset-memory.db
```

Each JSONL line contains `version: 1`, a unique `id`, `episode_id`, a timezone-aware
ISO `timestamp`, `uncertainty` in [0,1], explicit `split` (training/validation/test),
and the existing `before`, `after`, `action`, `context`, `relationships`, `outcome`,
`source` observation fields. The example is synthetic inventory data.

The current exact numeric learner requires zero declared uncertainty, one matching
context/action/relationship gate, and one int64 field schema. Supply 3–32 training,
1–16 validation, and 1–16 test records. Vary input fields independently to identify
coupled coefficients. Record IDs, input states, and episodes cannot leak across
splits. A whole episode belongs to one split. Test outcomes never enter fitting;
a failed test disables the hypothesis. Reports include a reproducible dataset
fingerprint and are saved with successful fits when a database path is provided.
CLI exit status is zero only when every test prediction passes. This supports
bounded numeric transition learning; arbitrary knowledge and noisy observations
require additional learning methods.

### Text questions using a learned inventory model

After fitting the example dataset into `dataset-memory.db`, use its reported model ID:

```bash
python text_transition.py --database dataset-memory.db --model-id MODEL_ID 'I have seven items and receive nine more. How many now?'
```

The answer is generated from stored learned coefficients without LLM calls. This
adapter uses an explicit English grammar and supports digits or number words
zero through ninety-nine, including twenty-one. It handles `receive`/`get` item
questions and `Current stock is 8 and incoming units are 4.` statements. It rejects
unsupported language, mixed units, wrong model context, disabled hypotheses and
inputs outside the model's observed range. The numeric transformation is learned;
the language grammar and output sentence are programmed. Image recognition and
learned general text understanding remain future work. This CLI is not yet exposed
in the web interface.

### Unseen composition of learned transitions

Run `python learned_planner_demo.py`. The demo fits receive and sell models from
separate synthetic before/after observations with independently varied fields.
No training observation contains an action sequence. Given stock 10, incoming 5,
outgoing 3 and target stock 12, the planner discovers a two-transition composition
and replays it through checked models. Four additional withheld combinations are
tested. This is bounded numeric compositional generalization, not learned language.

`LearnedTransitionPlanner.solve(initial, target, model_ids, context, relationships)`
requires explicit named int64 states, candidate model IDs, context and environment
relationships. Each model's context must match exactly; all of its relationship
conditions must be present in the supplied environment. These are caller-supplied
conditions, not discovered semantics. The goal specifies the desired state, not
an action sequence. Models retain schema/range/int64 checks and reject extrapolation.
Search deduplicates states and limits depth, nodes and frontier size. Unknown,
corrupt, disabled or inapplicable models are excluded with rejection counts.

`goal_satisfied` means the requested numeric state was reached under the learned
hypotheses and checked again by replay. `verified_outcome` remains false: this does
not operate a warehouse or independently prove physical outcomes. `knowledge_gap`
means no active candidate matches the supplied conditions; `bounded` means a search
limit was reached; `unsolved` means the reachable graph was exhausted. Counterexample
feedback disables models before future planning. This demonstration and Python
planner are not yet connected to the website or the English question adapter.

### Try learned planning and text questions in the web app

The home page now includes **Solve an unseen combination**. Enter your access
token, click **Learn the two demo behaviors**, and click **Find a plan** with the
default stock 10, incoming 5, outgoing 3 and target 12. Change inputs within 0..20
to test unseen combinations. The page displays discovered actions and state changes;
search failures explain missing applicability or exhausted bounds. Demo evidence
and model IDs are stored in the configured SQLite database.

For English inventory questions, load the **coupled inventory example**, then
click **Learn coupled hypothesis**. Its model ID fills the **Ask the learned
inventory model** panel automatically. Click **Answer without an LLM** to ask the
sample seven-plus-nine question. These separate panels use different model schemas.
The text panel does not translate arbitrary requests into planner goals.

API actions: `learned_plan_example` explicitly fits the synthetic demo models;
`learned_plan` accepts initial/target/model_ids/context/relationships and optional
max_depth/max_nodes/max_frontier; `text_transition_answer` accepts model_id/text.
All routes retain the existing hosted token and origin checks. No Gemini calls
are used by these routes. Predictions remain hypotheses, not observed outcomes.

### Supervised text-to-state pattern learning

The **Learn sentence patterns from examples** panel adds a bounded language-learning
experiment. Click **Load labeled text examples**, then **Learn and validate sentence
patterns**. **Read the state** tests the learned bindings. To calculate an answer,
learn the coupled inventory example below; its numeric model ID fills this panel.
The default `nine arrived; I already had seven.` yields stock 7/incoming 9 and a
predicted stock of 16 with no LLM calls. The original explicit grammar panel remains
available as a separate adapter.

`TextPatternLearning` induces literal token frames and numeric slot order from
labeled text/state/action/context/relationships/source pairs. No inventory or tank
sentence pattern is installed in this learner. Number words/digits use the existing
English decoder. Each frame requires three examples with three distinct values per
slot, plus held-out validation states and text. Ambiguous alignments, extra quantities,
failed validation and mixed schemas/gates reject. Up to four nonnegative int64 fields,
32 training records and 16 validation records are supported. Matching requires a
learned frame; novel syntax, open-ended definitions, perception and causal semantics
are outside this experiment. Semantic labels are supplied by the training author.

API actions: `text_learning_example`, `text_pattern_learn` (examples/validation),
`text_pattern_parse` (text_model_id/text), `text_pattern_answer`
(text_model_id/model_id/text), and `text_pattern_feedback` (text_model_id/example).
Models retain training/validation evidence and content hashes in SQLite. A matching
sentence with contradictory field labels disables its model. Unsupported new frames
are reported as gaps rather than automatically invalidating an existing frame.
Feedback does not modify coefficients or automatically retrain. Answering checks the
text model's gate against the independently learned numeric model. Numeric outputs
remain predictions with `verified_outcome: false`.

Tests use the same algorithm for inventory and tank text plus numeric prediction;
no domain-specific parser change is made for tank inputs. A local HTTP experiment
checks four withheld stock/incoming pairs using the learned reversed-order frame.
This shows limited supervised slot generalization, not general language understanding.
# Multi-pattern generalization benchmark

Run `python pattern_evaluation.py` from `b-stae` to fit four numeric behaviors
with the existing coupled learner: addition, subtraction, doubling and field
swapping. Each model receives five observed transitions and two separate
validation transitions. It is then scored on 25 new input pairs, including
negative values, using independent synthetic scoring oracles. No executable
oracle or arithmetic rule is passed to the learner.

The benchmark also asks the learned planner to reach `(x=18, y=4)` from
`(x=3, y=4)` without training on any action sequences. It finds addition,
doubling, addition: `3 -> 7 -> 14 -> 18`. Each step is scored against the
independent oracle. Context mismatch, range limits, depth limits, contradictory
feedback and unsupported variable multiplication are checked separately.

Current result: 116/116 benchmark checks, including 100/100 unseen predictions,
with zero LLM calls. These are reproducible synthetic results for exact affine
patterns with explicit action/context labels, not evidence of general language
understanding or universal intelligence. The benchmark uses temporary memory;
it does not install these models in a deployed application's database.

### Connected pattern memory (idea shift)

`Engine.patterns` retains original observations, including competing evidence,
with source/context provenance. `observe_text` links byte, Unicode character,
word/punctuation and sentence sequences to one observation. All contiguous
subsequences remain queryable by start/end positions; overlapping pieces share
the original sequence instead of being expanded into quadratic copies.
This retains observed evidence, not every possible abstraction or combination.
Boundary adapters are explicit; discovering boundaries is future work.

Run `python pattern_memory_demo.py` for unseen-prefix continuation, an unseen
copying analogy, and conflicting predictions retained together. Run
`python -m unittest discover -s tests` for regression tests.

The existing `/api` dispatcher supports `pattern_observe` (text/source/context),
`pattern_find` and `pattern_complete` (units/level/context), `pattern_learn_pair`
(before/after/level/source/context), `pattern_predict` (units/level/context),
and `pattern_stats`. This addition does not replace existing numeric learners.

`predict` transfers equality/copy/reordering structure from paired demonstrations.
It returns every distinct supported candidate and reports ambiguity rather than
deleting a conflicting example. Predictions are unverified hypotheses.
`complete` returns continuation evidence from all matching suffixes, ranked by
match length and support. Neither method learns meaning or answers arbitrary
questions. Retrieval currently scans sequences; large datasets need indexing.
Training requires no neural network, GPU, or LLM calls for this experiment.

### Relationship discovery experiment

`Engine.discovery_patterns` now synthesizes candidate programs from stored
input/output observations. There is no task-name switch for reverse, rotate,
duplicate, etc. The implementation supplies a small hypothesis language:
concatenate slices (including backward traversal and strides), observed literal
units, and fitted numeric polynomials of degree up to two.
Examples determine programs; the language, endpoint vocabulary, and search
limits remain programmed assumptions. This cannot discover arbitrary behavior.

Use `pattern_learn_pair` to store demonstrations, `relationship_discover`
(level/context/max_programs/max_parts/max_stride/endpoint_radius) to search, `relationship_inventory` to
inspect all generated programs with supporting/conflicting example IDs, and
`relationship_predict` (units/level/context) to obtain candidate outputs.
Programs remain persisted after contradictions. At least two distinct inputs
of two different lengths must support a program before prediction uses it.
This eligibility heuristic is not a correctness guarantee. Unsupported and
ineligible hypotheses stay in inventory. Candidate ordering uses support count;
it does not erase alternatives. No success/failure feedback learner is claimed.

Run `python relationship_discovery_demo.py`. Its three training lengths and
three test lengths differ, and test symbols are withheld. Independent oracles
only generate observations and score outputs, never executable learner rules.
Search reports truncation when its program/expansion bounds are reached.
Each example searches up to 100,000 fragment expansions. Stored observations
are not truncated. Inventory currently recomputes evidence by scanning examples.


Expanded discovery supports strides up to four and endpoint offsets up to three
by default, configurable up to sixteen and eight respectively. Up to three
parts can be concatenated (`max_parts=3`; default remains two). Numeric
coefficients are fitted using exact rational arithmetic from aligned numeric
observations, with a fixed maximum polynomial degree of two. Predictions with
fractional values are converted to floating point, so output precision remains
limited. Numeric programs reject nonnumeric inputs. Type/overflow rejection
leaves programs stored. This does not yet learn comparisons, arbitrary loops,
semantics, or arbitrary mathematical functions. Increasing search bounds may
cost more CPU and produce more hypotheses, not necessarily better answers.

### End-to-end pattern runtime

The Connected pattern learning panel now exposes example ingestion, discovery,
prediction, target selection, multi-context composition, and outcome feedback.
Run `python app.py` from `b-stae` and open its printed local URL. The panel's
examples demonstrate two isolated numeric relationships; the combined solution
is not included in training. Its context names are user labels, not inferred
intent. No external actions are performed by this experimental runtime.

API actions:
- `pattern_select`: units/level/context/optional goal array.
- `pattern_plan`: units/target/level/contexts array; optional max_depth/max_nodes/max_units.
- `pattern_feedback`: units/actual/program/level/source/context/optional goal.
- `pattern_outcomes`: level/context.

Feedback remains append-only with source, input, predicted output, actual output,
and target evidence. Observations can conflict without erasing each other.
Accuracy evidence is evaluated against every hypothesis in the same explicit
context, so equivalent programs cannot escape a counterexample merely by
having a different encoding. Goal outcome evidence applies only to the attempted
program and exact target. Sources and supplied outcomes are not independently
verified. Ranking uses evidence counts, not calibrated probabilities.

Planning composes best-scoring eligible programs per context in a bounded
breadth-first search. Other programs remain in inventory; search failure does
not prove the goal impossible. Every returned step includes its program and
supporting/conflicting example IDs. Target equality is verified computationally;
real-world outcome success remains unverified. Search defaults: depth four,
256 states, maximum 128 units per state. It searches at most eight transitions
when configured; these bounds are computational limits, not knowledge deletion.

Run `python pattern_runtime_demo.py` for twenty unseen composite targets, with
independent oracle checks and contradictory feedback retained together.
Run `python -m unittest discover -s tests` from `b-stae` for the full suite.
Remaining research: learned context/intent, broader program languages, real
corpora, grounded image/audio learning, scalable indexing, and calibration.

### Learned requests and modality adapters

The Learn a request and its behavior panel stores request-to-context examples
and input/output observations. `request_pattern_learn` accepts text/context/source;
`request_pattern_route` accepts text. Routing derives unigram/bigram evidence
from supplied examples, without an installed mapping from command words to
operations. Labels remain supplied by the user; scores are uncalibrated.
Shared/conflicting request features remain and may yield ambiguity. Unseen
synonyms, negation, or complex instructions are not reliably understood.

The same sequence discovery/runtime operates on Unicode characters, packed
RGB pixels, and PCM16 samples. Actions `multimodal_pattern_learn` accept
before/after/context/source; `multimodal_pattern_discover` and
`multimodal_pattern_predict` accept value/context; `multimodal_pattern_request`
accepts text/value and routes to a learned context. Formats:

- Text: a JSON string.
- Image: `{"image":{"width":2,"height":1,"rgb_hex":"ff00000000ff"}}`.
- Audio: `{"audio":{"samples":[100,-100,200],"sample_rate":16000}}`.

Adapters enforce image dimensions, valid pixels and PCM16 range. Training pairs
must share format and dimensions; examples can vary dimensions across pairs.
Predicted image size is preserved, and unsupported sizes/values are rejected
without deleting the hypothesis. Audio format context includes sample rate;
the experiment supports at most 4096 samples, not complete speech recordings.
The interface renders pixel outputs and provides manual playback of generated
PCM WAV output. Those decoders/renderers are installed code, not learned meaning.
No text-to-speech, speech recognition, object recognition, or unrestricted
semantic understanding is claimed. Current tests are synthetic, not real-world
accuracy estimates. Run `python multimodal_learning_demo.py` for nine held-out
request/signal cases. All request phrases and tested signal sequences differ
from training, but share learned words or transformation structure.

Selection now prefers fewer program parts when evidence scores tie. This is
a parsimony heuristic, not proof of correctness, and all alternatives remain
visible. Contradictions and failure evidence remain append-only.

### Dataset import and held-out evaluation

`pattern_dataset.py` imports JSONL with explicit splits. A 76-record synthetic
starter dataset is included at `examples/pattern-starter.jsonl`, reproducible
with `python examples/build-pattern-dataset.py`. It contains 25 training records,
15 validation records, and 36 test records, including one unscored raw-text test.
This is pipeline validation, not a real-world accuracy benchmark.

From the `b-stae` directory:

```sh
python pattern_dataset.py examples/pattern-starter.jsonl --database my-pattern-memory.sqlite3 --name starter-v1 --report starter-report.json
```

The local interface also accepts a JSONL file and displays import/evaluation
reports. It supports files up to 900 KB, subject to the existing 1 MB API request
limit. CLI imports are limited to 16 MiB and 10,000 records for this experiment.
Neither limit is a tested production capacity. Discovery can be costly as stored
examples grow; begin with small batches.

Every record needs `id`, `episode_id`, `split` (`training`, `validation`, `test`),
`kind`, `source`, and `context`. Kind-specific fields:

| Kind | Fields | What it teaches |
|---|---|---|
| sequence | before/after arrays and level | Sequence/numeric transformations |
| request | text | Request-to-context associations |
| multimodal | before/after supported values | Character, RGB pixel, PCM transformations |
| raw_text | text | Observation patterns only; no answer target |

Example sequence record:

```json
{"id":"train-1","episode_id":"episode-1","split":"training","kind":"sequence","source":"my-observation","context":"task-a","level":"number","before":[1,3,5],"after":[2,6,10]}
```

Keep related examples in one split via their episode IDs. Exact inputs cannot
cross splits, including prior dataset imports and already learned input/output
examples. Request input checks normalize case and whitespace. Multimodal input
checks use its underlying sequence representation. These checks do not detect
all paraphrase/semantic leakage. Tests never supply their answer as a selection
goal and never update feedback or learner memory. Later direct learning of a
held-out input causes evaluation to fail rather than report contaminated scores.

Validation and test rows stay in a separate staging table. Only training rows
reach learners. Complete batches validate before writes, and failed imports
restore an SQLite backup, including any intermediate learner writes. Identical
reimports under the same name do not repeat training; changed content requires
a new name and still passes split checks. Original source/context evidence stays.
Backups incur additional memory cost on larger databases.

Reports include exact-output accuracy, alternatives/ambiguity, expected-answer presence among candidates,
elapsed time, records/cases per second, Python allocation peak, process lifetime
peak RSS where supported, and SQLite allocated size. Python tracing excludes
some native allocations; RSS is a process peak, not incremental training memory.
SQLite size excludes filesystem sidecars. A raw-text row has no prediction
oracle and is explicitly unscored. Learned formats and hypothesis limits still
apply; arbitrary books, images, or speech do not automatically teach semantics.

### Missing-word language experiment

The Learn missing words panel trains word-context counts and fills a single
`<mask>` in a new sentence. `text_gap_learn` accepts text/source/context/window;
`text_gap_predict` accepts text/context/window; `text_gap_baseline` accepts
context; `text_gap_evaluate` accepts cases (text/expected) and context.
Training text is at most 20,000 characters per call; window defaults to three
and can be 1..6. The SQL index stores left/right context occurrences and source
references. Original observations and conflicting alternatives remain stored.
It is a bidirectional n-gram count experiment, not a neural language model.

Candidate ranking prefers longer observed contexts, then occurrence support.
Equal evidence remains ambiguous. Unknown contexts return unknown instead of
inventing a word. The learner only proposes observed words/numbers, case-folds
text, uses explicit word/punctuation boundaries, and cannot create a new
vocabulary item or reason about meaning. Windows bound the retrieval index,
not retention of the original text and its addressable patterns. Repeated
training calls add observations and counts, including identical sentences.

Run `python text_gap_demo.py` for the transparent synthetic benchmark: eleven
training sentences and twelve unseen complete test sentences. Nine are answered
correctly, one is ambiguous, and two are unknown; the most frequent training
word baseline scores zero. These test sentences reuse observed local contexts.
This is not evidence of general semantic understanding or real-corpus accuracy.
Evaluation rejects test sentences that occur anywhere in a training document,
rejects duplicate test sentences, and never updates learning or feedback.
The existing dataset importer's raw_text kind remains observation-only; it does
not silently train this experimental language predictor.

### Passage-only question test

Run `python passage_question_evaluation.py`. Two fictional passages are the only
learning inputs; no question/answer pairs or question-to-cloze conversion rules
are supplied to the model. Expected answers remain evaluator-only. The current
text predictor rejects six ordinary questions because it requires a single
mask, and the request router has no labeled request evidence in this experiment.
Six cloze reformulations match local contexts and score correctly. A control
changes the moved object from key to coin: the model still fills the key's
location with drawer, although the key remained in the green box. This is a
measured distinction between word-context matching and fact tracking. These
results describe this implementation, not a disproof of other pattern-memory
architectures. No LLM calls or evaluation learning updates occur.

### Phrase and sentence-length prediction

`SentenceLearning` reuses the passages learned by `text_gap_learn`. Instead of
one word, it considers observed contiguous spans up to 24 tokens (configurable
1..64). It ranks spans by adjacent matching context, then occurrence support,
with source/document/start/end provenance. All original observations remain.
The Learn phrases and sentences panel provides separate passage training,
multiword masks, and continuation to an explicit punctuation boundary.

API: `sentence_predict` accepts text/context/window/max_tokens/sentence_end;
`sentence_continue` accepts text/context/max_tokens; `sentence_evaluate` accepts
cases (text/expected) and context. Evaluation rejects already seen completed
prompts and duplicate test prompts, and performs no learning updates.

Run `python sentence_learning_demo.py`. Of five synthetic cases, three gaps are
correct (including a complete sentence), one retains two conflicting phrases,
and one is unknown. The completed prompts are unseen; the returned answer spans
are observed. A new prefix also completes to a sentence. This demonstrates
contextual span retrieval, not open-ended generation, semantic comprehension,
or fact tracking. It currently scans stored documents, so larger corpora need
additional indexing and retrieval benchmarks. Case-folding and simple
punctuation tokenization remain explicit adapter assumptions.

### Learned text transformations (rather than phrase lookup)

`TextRelationshipLearning` induces linked templates from 3..32 labeled examples
(statement/question/answer/source). Longest-common-subsequence alignment finds
shared anchors; varying spans become slots. Output slots are linked to input
slots when their values correspond across all examples. Inference binds a new
statement's variable spans, generates a question and an answer, and checks a
supplied question against that generated question. No installed grammar names
specific verbs or question phrases. The generic alignment/binding language is
still programmed; this is supervised template induction, not arbitrary grammar
or raw-text semantic learning.

API: `text_relation_learn` (examples/context), `text_relation_transform`
(statement/context), and `text_relation_answer` (statement/question/context).
The Learn text relationships panel exposes those steps. Text is case-folded;
up to 64 tokens per field, 32 binding alternatives, and 10,000 binding expansions
are supported. Search-limit results report bounded. Statements outside learned
anchors or questions about a different bound subject return unknown.

Every training example stays even when its outputs cannot be expressed through
this hypothesis language. Multiple conflicting models remain and return
ambiguity. Source IDs and variable bindings accompany each candidate. A learned
frame does not independently verify labels or factual truth. There is no event
chronology, multi-fact reasoning, or unrestricted generation here.

Run `python text_relationship_demo.py`. All three unseen statements are answered,
including unseen multiword subjects and objects. Both their generated questions
and answer values are absent from training. Answer values come from the new
statement, not memorized training outputs. A new verb remains unknown. Tests
also cover changing an object's value, a different learned relationship, and
conflicting labels. This does not establish general language understanding.

### Connected structured-memory experiment

`python memory_logic_demo.py` tests transfer from labeled input/output records.
The **Learn relationships in memory** panel exposes `memory_logic_learn`
(`examples`, `context`) and `memory_logic_predict` (`record`, `context`).
Example input `{ "entity": "rabbit", "count": 3 }` produces
`{ "form": "rabbits", "count": 3, "multiple": true }` after four supplied
examples. This output record connects a learned spelling transformation with a
learned integer comparison and a copied count. Field names have no built-in
entity/plural semantics: renaming them preserves the experiment's behavior.

The programmed hypothesis language contains whole-sequence bindings with
observed prefixes/suffixes, aligned sequence templates, copy links and integer
`>`/`<=` comparisons. Both UTF-8 byte and Unicode character models use the same
binding machinery and are linked to the same training record IDs. The comparison
threshold is selected from observed counts, and the suffix comes from observed
outputs. Record boundaries, field labels, examples and Boolean target values are
supplied; concept meaning and raw-text parsing are not discovered. Word/sentence
levels are not implemented in this extension. A novel surface form is not proof
of acquired semantic understanding.

All examples and model batches persist in SQLite. Unsupported batches and
exceptions remain as evidence; exact observations and induced predictions are
both returned. Thus `mouse` yields conflicting `mice` and `mouses`, rather than
silently choosing or deleting one. Exception routing is not yet learned.
Prediction does not update memory. Inputs are limited to eight scalar fields,
128 characters per string, 3..32 training records per batch; binding search is
bounded and combination search returns at most 128 combinations per model.
`search_limited` signals incomplete search. Unseen predictions remain unverified.

### Learned text ↔ memory bridge

`python text_memory_demo.py` tests paired text/record learning and composition
with the structured-memory comparison learner. The **Learn text and memory
connections** panel trains plural and singular frames in separate batches,
parses an unseen phrase and expresses a record as text. APIs:
`text_memory_learn` (`examples`, `context`), `text_memory_parse` (`text`,
`context`), `text_memory_express` (`record`, `context`).

Each example is `{ "text": "three dogs", "record": { "entity": "dog",
"count": 3 } }`. Three varied entities let the engine infer a word-position
binding and observed affix; scalar labels build a reversible observed vocabulary
(e.g. `three` ↔ `3`). No English quantity words or plural suffix are installed.
Three unseen tests round-trip correctly: `three rabbits`, `two cafés`, and
`one rabbit`. Their parsed records can enter the existing memory-logic learner,
which independently predicts the quantity relationship `multiple`.

This is supervised alignment with supplied record labels and frame batches,
not discovery of meanings from arbitrary text. Tokenization is supplied as
whitespace boundaries. Templates require a fixed token count, string fields
have at least three distinct training values, and string captures are single
nonempty tokens. Numerical vocabulary is observed lookup, not extrapolation:
`five rabbits` stays unknown until a matching vocabulary example is learned.
Multiword entities and unrestricted grammar are unsupported. All paired
observations remain, including unsupported batches; conflicting models return
ambiguity. Read-only parsing/expression does not reinforce itself. No LLM is
called. Bounds: 3..32 examples, 512 text characters, 16 tokens, 64 template
combinations per training batch, 128 parse states per position per model.

### Numerical word and sentence hierarchy

The **Numerical text representation** panel and `python numeric_text_demo.py`
show lossless sentence IDs → ordered token IDs → Unicode codepoints → UTF-8
bytes. APIs: `numeric_text_encode` (`text`), `numeric_text_decode`
(`sentence_id`), `numeric_text_decode_tokens` (`token_ids`). Decode reconstructs
text from the stored links and verifies each character's UTF-8 representation;
it does not retrieve a stored full sentence string. Whitespace and punctuation
are tokens too, so spacing, repetition, ordering and Unicode survive exactly.
`word_ids` excludes those separators; use `token_ids` for lossless reconstruction.

IDs are categorical identifiers, stable within this database and across its
restarts; different databases can assign different IDs. Do not apply numerical
arithmetic to IDs to infer quantities or meanings. A new `three rabbits` sentence
reuses the word IDs learned by encoding `three cats` and `two rabbits`. New
text/record bridge training examples also retain sentence-ID and string-field
links into this hierarchy. The bridge still performs supplied whitespace-token
alignment; storing numerical links does not turn it into a byte-only semantic
learner. Existing saved bridge examples remain compatible without migration.

This is representation infrastructure, not a new learning achievement. Token
boundaries are supplied using Unicode word/space/punctuation groups. Each input
is treated as one sentence unit, rather than discovering sentence boundaries.
Encode writes/reuses persistent nodes; decode is read-only. Bounds: 4096 Unicode
characters, 512 tokens per input or decoded sequence. Unknown IDs and inconsistent
character-byte links are rejected. No Unicode normalization is applied.

### Experimental meaning memory

`python meaning_demo.py` connects three explicitly supervised components:
text/record alignment, state relationships, and labeled before/after changes.
The **Relationships and predicted consequences** panel supplies training
examples and inspects unseen expressions or reads a named field. APIs:
`meaning_learn_expressions`, `meaning_learn_relations` (each `examples`,
`context`), `meaning_learn_changes` (`examples`, `label`, `context`),
`meaning_inspect` (`text`, `context`), `meaning_read_field` (`text`, `field`,
`context`). Expression examples use `text`/`record`; relationships and changes
use `input`/`output` records. Contexts isolate different interpretations.

After training, unseen `three rabbits` parses to `{entity: rabbit, count: 3}`;
the learned comparison yields `multiple: true`, and the fitted transformation
for the supplied action label predicts `{entity: rabbit, count: 4}`. Field
queries return `count=3` and `multiple=true` with evidence. Unknown expressions
and missing fields remain unknown; contradictory change models remain ambiguous.
Action labels are linked to numeric sentence IDs but their wording is not
interpreted. No real action is executed or verified.

The underlying structured learner now supports exact rational fitted numeric
polynomials of degree 0..2 (at least three distinct integer inputs), as well as
observed constants, copies, sequence transformations, and comparisons. These
are programmed hypothesis classes; coefficients and constants are learned from
outputs. A fitted relationship may extrapolate incorrectly. Numeric fitting is
for supplied quantitative fields, never arbitrary word IDs. Read-only queries
retain all provenance and perform no training updates.

This is an operational experiment in meaning as associations and expected
consequences, not a claim that the model discovers concept meaning unaided.
Entity/count/multiple labels, expression frame groups, and paired action states
are supplied by the trainer. Natural-language question interpretation, grounding
in physical observations, raw-text semantic discovery, causal identification,
and unrestricted reasoning remain unimplemented. Existing module bounds apply.

### Connected prototype: one complete flow

Run `python app.py`, open the printed local URL, and use the first panel,
**B-STAE connected prototype**. Learn its supplied examples, enter
`three rabbits`, leave the learned change label as `add-one-observation`, and
click **Run connected prediction**. It parses `{entity: rabbit, count: 3}`,
predicts `{entity: rabbit, count: 4}`, and expresses `four rabbits`. Clearing
the change label reads and expresses the current state. This simulates a
learned change; it performs no external action.

API: `meaning_run` (`text`, `context`, optional `label`, optional `level` of
`byte` or `character`, default `byte`). The response includes original
readings, candidate output records, their derived relationships, expression
candidates, numeric input/output sequences, evidence, and explicit uncertainty.
`status` describes the predicted state candidates. Each outcome's
`expressions.status` separately describes whether wording is available.
Thus a predicted count of five remains visible even when the vocabulary has
not learned `five`. Unknown inputs/actions and conflicting effects remain
unknown/ambiguous, rather than being silently chosen.

The text bridge now induces templates separately over UTF-8 integer sequences
and Unicode codepoint integer sequences. Runtime matching, affix slicing,
vocabulary lookup, and output assembly operate on those numbers. Decoding
occurs at the typed-record/string and human-output boundaries. Word boundaries
remain a supplied whitespace adapter; word and sentence IDs retain hierarchy
links, but arbitrary ID arithmetic is never used. Older string templates are
compiled to numeric templates in memory on reads, preserving saved evidence.
New template search limits propagate to prediction. Existing context/data APIs
remain compatible; `text_memory_parse` and `text_memory_express` also accept
`level`. Inference remains read-only and uses no LLM.

`python complete_flow_demo.py` is the repeatable whole-flow experiment, with
unseen rabbit/café inputs in both numerical modes, unknown vocabulary, and
contradictory effects. This completes the current bounded, supervised prototype;
raw-data semantic discovery, general language understanding, learned boundaries,
and universal intelligence remain research goals. The prototype is not a
production-ready general AI.

### Expanded labeled sentence training

`python expanded_text_training.py` reproducibly trains 36 examples across six
separately labeled frames: carries, gives, finds, likes, uses, and holds. It
checks 18 held-out subject/object combinations and three untrained grammatical
variants. To retain training in the local app's default database, run
`python expanded_text_training.py --db knowledge.sqlite3` (or specify the app's
configured database). Frame context names are carrying/giving/finding/liking/
using/holding; call `meaning_run` with the corresponding context and no action
label. This learns role extraction and round-trip wording within supplied
frames, not physical consequences or unrestricted language understanding.
