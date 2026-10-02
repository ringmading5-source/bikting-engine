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

### Scaling and structural holdout benchmark

Run `python scale_benchmark.py` for six supplied sentence contexts at 36, 180,
600, and 1800 total training records. Each size uses a fresh temporary SQLite
memory. Training uses artificial `personN`/`objectN` words; 180 test sentences
use unseen `travellerN`/`mapN` words. Thirty tests add a subject modifier, and
thirty remove terminal punctuation. These require absent structures and are
reported separately from lexical transfer. Test examples do not train the
model. Six contradictory label checks run only after measurement and preserve
ambiguous candidate roles. Reports include training time, median/p95 parse
latency, traced Python memory peaks, and allocated SQLite pages.

The recorded single-run result is 180/180 correct new-word records at every
size; 30/30 unseen structures and 30/30 punctuation variants remain unknown.
All 24 conflict checks across the four sizes remain ambiguous. Median parse
time rises from about 0.40 ms (36 records) to 10.92 ms (1800), with allocation
tracing enabled. Training time rises from 0.09 s to 4.51 s. At the largest
size SQLite allocates 937984 bytes after conflict checks; traced Python peaks
are 445060 bytes during training and 73017 bytes during inference. Those are
not measurements of total process/native memory. See
`examples/scale-benchmark-report.json` for complete values and limitations.

This supports narrow fixed-frame transfer and reveals a scanning cost; it
provides no evidence that more examples alone teach new grammar or general
meaning. Context is supplied, batches are labeled, words are synthetic, and
sentence complexity remains small. Timings are from one environment and one
run per size, not a production capacity estimate or comparison with LLMs.
The exact-training-sentence lookup baseline abstains on all unseen-word tests.

### Recursive discovery from characters/bytes upward

The **Discover patterns from characters upward** panel and
`python recursive_pattern_demo.py` start from raw UTF-8 bytes or Unicode
codepoints. No word boundaries, sentence templates, semantic roles or numerical
quantity labels are supplied. Observation boundaries and sources are supplied.
Each round counts adjacent units, chooses a frequent pair supported in at least
two distinct observation contents, creates a linked composite unit, and replaces
nonoverlapping occurrences. Later rounds can merge these learned units again.
This is bounded symbolic frequent-pair discovery, similar to a merge tokenizer,
not semantic learning or proof of general reasoning.

On five raw carrying sentences, both modes discover 17 composites with maximum
nesting depth six, including `Th`, `The`, `The `, and ` carries `. The working
training sequences shrink from 118 to 46 units; unseen `The traveller carries
maps.` uses 14 working units rather than 27 characters and round-trips exactly.
Working-unit reduction does not measure total memory or storage savings. Some
patterns cross word boundaries, e.g. `t carries bo`; they are recurring spans,
not guaranteed linguistic words or concepts. Encoding a new string does not
predict facts, answers, or a new sentence: this learns representation structure.

All raw observations, sources, considered pairs, support counts, selected merge
rules, hierarchy nodes, and run versions persist. Unselected candidates are
retained. By default, later training incorporates earlier observations in the
same context and mode and re-estimates a hierarchy; no observations are removed.
Repeated identical text does not count as distinct-document support. Older
versions remain stored; encoding selects the latest version. Character and byte
modes have separate typed nodes. New characters use numerical literal units,
so Unicode can round-trip without inserting vocabulary during inference.
No exponential growth claim is made: at most one composite is selected per
round, and hierarchy depth is bounded. Candidate growth and correct reasoning
growth are different measurements.

APIs: `recursive_pattern_learn` (`examples` containing `text`/`source`, `context`,
`mode`, `rounds`, `max_depth`, `min_documents`, `include_history`),
`recursive_pattern_inventory` (`context`, `mode`), `recursive_pattern_encode`
(`text`, `context`, `mode`), `recursive_pattern_decode` (`units`, `mode`).
Default mode is character, rounds=24, max_depth=8, min_documents=2,
include_history=true. Bounds: 2..128 new examples, up to 512 Unicode characters
per observation, 128 historical-plus-new observations, 16384 base units per
training context, 64 rounds, depth 16. Encoding and decoding are read-only and
verify reconstruction. Byte fragments may split a Unicode character; inventory
retains numerical bytes even when a fragment has no standalone readable form.
The existing semantic bridge still uses supplied frames; integrating newly
discovered units into broader semantic transformation discovery remains future
work. This extension does not make the model universally intelligent.

### Learned transformations over composed states

`python composed_state_demo.py` and **Learn and compose state transformations**
connect paired transformation learning to the recursive byte/character hierarchy.
Three distinct paired examples support each whole-state concatenation rule:
`output = prefix-state + complete-input-state + suffix-state`. Prefixes and
suffixes come from observed outputs, not installed English rules. The complete
input's learned unit sequence is copied, and learned literal state sequences
are concatenated around it. State IDs are never added numerically. This supports
novel string states and multi-step composition while keeping ordered structure.

Tests learn `cat → cats`, `dog → dogs`, `horse → horses`, then produce
`rabbit → rabbits`. A separate paired batch learns `cat → The cat sleeps.`;
another learns `The cat sleeps. → Report: The cat sleeps.`. Composing both on
`rabbit` produces `Report: The rabbit sleeps.`, absent from training. Character
and byte modes agree, including novel Unicode inputs. These outputs are symbolic
rewrites, not factual claims about animals or proof of acquired semantics.

The hypothesis language is deliberately narrow: prepend/append observed
literal states while copying the whole input. It does not learn arbitrary
internal edits, reordered roles, unrestricted grammar, physical behavior, or
word meanings. Paired targets and transformation contexts are supplied. Raw
before/after strings also enter hierarchical discovery without word boundaries.
The same composition operator applies to short word-like states and longer
sentence-like states; it does not automatically classify those levels.

All paired examples, stable unit links, candidate rules, sources, support and
counterexamples remain. Irregular `mouse → mice` remains as evidence while the
learned append rule predicts `mouses`, producing ambiguity on the observed
input. No new generic rule is invented for unsupported irregular changes.
Inference and path composition are read-only. They can create new combinations
of existing state units and numerical literals without reinforcing predictions
as facts. Intermediate strings are re-encoded by the next learned hierarchy,
while the per-stage trace preserves transition evidence.

APIs: `composed_state_learn` (`examples` of `before`/`after`/`source`, `context`,
`mode`), `composed_state_predict` (`text`, `context`, `mode`),
`composed_state_inventory` (`context`, `mode`), `composed_state_compose`
(`text`, ordered `contexts`, `mode`, `max_candidates`). Training needs 3..32
examples with three distinct inputs. Recursive corpus budgets apply separately
to each transformation context/mode. Composition supports 1..8 steps and
1..128 distinct outputs per stage (default 32); truncation reports `bounded`.
Strings remain capped at 512 Unicode characters. A stage graph retains incoming
edges without recursively duplicating all path histories. Multiple paths can
produce multiple candidates; exponential correct-knowledge growth is not
assumed or demonstrated.

### First–last–count candidate search and recursive verification

The **Search states by first, last and count** panel stores numerical states
and compares two strategies on identical queries. `boundary_state_observe`
takes `units`, `payload`, `source`, `context`, and `mode`. `boundary_state_search`
takes `units`, `context`, `mode`, `strategy` (`indexed` or `scan`),
`max_candidates`, and `max_nodes`. A compound SQLite index selects by context,
mode, first unit, last unit and total count. Every candidate's interior is
verified recursively: compare span endpoints, split the span, then verify both
halves down to spans of at most two units. Equal boundaries never imply semantic
or structural equality. `cat` and `cot` collide in the root signature but the
interior verifier rejects the incorrect match.

New composed-transformation examples also enter this index. Existing examples
are backfilled on engine startup; original records and evidence are preserved.
`composed_state_predict` defaults to indexed observation retrieval and accepts
`strategy='scan'` for a controlled comparison. Applicable learned transformation
rules are still evaluated independently: unseen inputs are not discarded just
because they lack an exact stored-state match. Full rule support/counterexample
inventory still scans evidence, so this change does not remove all application
scanning costs or improve semantic generalization.

`python boundary_search_benchmark.py` compares both strategies using the same
recursive verifier on 38, 182, 602, and 1802 stored synthetic states. In the
recorded run, six queries over 1802 states require 10812 full-scan candidate
checks versus seven indexed checks, with identical matches and unknowns.
Median across ten batch timings is about 10.13 ms per query for scanning versus
0.09 ms for the index. These measure this retrieval component on in-memory
SQLite, not end-to-end application latency. Signatures are deliberately varied;
large buckets of identical signatures can eliminate the advantage. Exact
retrieval quality is unchanged, and the benchmark does not demonstrate new
reasoning capabilities. See `examples/boundary-search-report.json`.

Inference is read-only. Default bounds are 2048 candidates and 65536 recursive
verification nodes across the whole query, with maxima 10000 and 1000000.
Exhausted bounds return `bounded`; unfinished interiors are never accepted as
verified. States contain 1..2048 bounded integer units. Byte/character/symbol
modes remain isolated. Unit IDs are identities, not arithmetic quantities.
Duplicate observations and different payloads remain available; reference-based
migration is idempotent and rejects attempts to replace different evidence.

### Internal copying and reordering on learned states

`python internal_state_demo.py` and **Learn changes inside a state** extend
paired transformation learning beyond whole-input prefix/suffix concatenation.
The engine discovers a recursive hierarchy from raw before/after observations,
aligns recurring unit sequences, identifies variable spans, and links output
variables to uniquely matching input variables across examples. Copied variables
can appear in a different order. No word boundaries or named semantic roles
are supplied; paired target strings and context labels still are.

Three examples such as `the cat carries books. → books are carried by the cat.`
support unseen `the traveller carries maps. → maps are carried by the traveller.`
and multiword `the young traveller carries old maps. → old maps are carried by
the young traveller.`. Byte and character modes both pass three held-out tests,
including a novel Unicode subject. The whole-input concatenation learner cannot
fit this rewrite, providing a controlled capability comparison. This is narrow
structural generalization, not automatic understanding of carrying, unrestricted
passive grammar, or discovered world facts. Training object endings remain
literal constraints: an untrained singular ending or past-tense verb can remain
unknown. Some paired transformations cannot be aligned and remain unsupported.

Numeric boundary indexing retrieves exact observed exceptions, while learned
models run independently on new inputs. Model bindings use hierarchical units.
A base-numerical alignment check expands the same learned literal anchors to
expose alternatives hidden by merge segmentation. Thus `the robot carries books
carries maps.` yields two alternatives instead of accepting a single apparently
unambiguous segmentation. All alternatives, unsupported paired observations,
source links, model versions and evidence remain. Conflicting learned targets
produce ambiguity. Inference does not train itself.

Every model pins its hierarchy run version, so later merges do not silently
invalidate the representation it learned. Recursive encoding supports an
optional `run_id` internally and remains read-only. Bounds: 3..32 paired examples,
256 hierarchical units per training sequence, 256 entries in the expanded input
pattern, 32 bindings and 10000 binding-search expansions per alignment. Existing
recursive text/corpus bounds also apply. Exhausted bounds produce `bounded`.
Template induction uses a longest-common-subsequence hypothesis and bounded
copy links; it is not an exhaustive program search.

APIs: `internal_state_learn` (`examples` of `before`/`after`/`source`, `context`,
`mode`) and `internal_state_predict` (`text`, `context`, `mode`, `strategy`).
`strategy` controls exact observation retrieval (`indexed` default or `scan`),
not whether learned transformations are evaluated. Default mode is character.

### More reliable alignment and learned question → knowledge answering

Internal-state learning now tests three bounded hypothesis families: LCS over
hierarchical units, LCS over underlying numerical units, and a generic
common-prefix/suffix single-variable template. All hypotheses must reproduce
all supplied training outputs before they are stored. Multiple valid hypotheses
and contradictory predictions are retained. This fixes the observed failure
where `what is biology/physics/history? → define biology/physics/history` could
not align merged units; both that three-subject set and the six-subject set now
transfer to chemistry and organic chemistry in byte/character modes. Saved
older models remain compatible. There is no installed `what is` handler.

`python knowledge_question_demo.py` and the first panel, **Learn question
patterns and answer from knowledge**, connect learned request patterns to
supplied subject/definition/source records. Training pairs identify canonical
subjects for three question forms: `what is X?`, `define X`, `tell me about X`.
The runtime tries registered learned patterns automatically rather than taking
an explicit frame from the question. Chemistry, organic chemistry, and
mathematics are absent from pattern-training subjects, but their definitions
are separately supplied. All nine combinations pass in each numerical mode
(18/18), with evidence. Missing facts and unsupported question forms return
different unknown reasons. Contradictory definitions return ambiguity and their
sources; the engine does not independently determine which definition is true.

Definition lookup uses first–last–count candidate indexing and recursive
interior verification of the extracted subject. Definitions retain numerical
sentence/character/byte links and are decoded from those links. Request strings
are trimmed/casefolded by a supplied normalization adapter. Definitions preserve
their original wording. This is learned question-pattern transfer plus indexed
retrieval, not learning subject knowledge from arbitrary raw passages, causal
reasoning, or inventing facts. More data still does not automatically expand
the hypothesis language into unrestricted grammar.

APIs: `knowledge_question_learn` (`examples` of `before`/`after`/`source`, `label`,
`context`, `mode`), `knowledge_fact_learn` (`facts` of `subject`/`definition`/
`source`, `context`), `knowledge_question_answer` (`question`, `context`, `mode`).
Question-pair and recursive corpus budgets apply per pattern label/mode.
Fact batches support 1..10000 records, subjects up to 128 characters,
definitions up to 512 characters, and sources up to 256 characters. All facts
are retained; fact records are not implicitly overwritten. Queries are
read-only. This is a definition-answering capability with supplied canonical
subjects, not a general natural-language question-answering system.

`python question_growth_benchmark.py` separately tests question alignment at
3/6/12/24 examples in both modes and knowledge volume at 3/30/300/1200 supplied
records. Recorded results: 24/24 held-out rewrite checks pass across the eight
alignment runs; knowledge runs pass 9/9, 12/12, 12/12, and 12/12 requests.
Median answer time at 1200 records is about 3.51 ms across five timing repeats
in one environment. SQLite allocates 1163264 bytes including shared models and
representations. This is not total process memory, an LLM cost comparison, or
a production capacity claim. Larger-volume records are explicitly synthetic.
See `examples/question-growth-report.json` and
`examples/knowledge-question-report.json` for results and limitations.

### Incremental pattern adaptation

`adaptive_patterns.py` accepts one supervised `before`/`after`/`source` example
at a time. It searches triples containing the new observation for generic
common-boundary and LCS copying/reordering rules over character numbers or UTF-8
bytes. No question words, plural suffix, or family labels are installed. At
least three distinct supporting inputs are required for generalization.

All observations, distinct rules, supporting evidence, and contradictory evidence
persist. Applicable rules contribute candidates together; contradictions are not
erased or resolved by a confidence score. Exact observations are retrieved via
the first/last/count index with recursive interior verification. Prediction does
not write memory or call an LLM.

The first UI panel exposes single-example learning, six supplied demo examples,
and prediction. API actions: `adaptive_pattern_observe` (before, after, source,
context, mode), `adaptive_pattern_predict` (text, context, mode), and
`adaptive_pattern_inventory` (context, mode).

Reproduce with `python adaptive_pattern_demo.py`. In the synthetic experiment,
question extraction is unknown after one or two observations, then predicts
`chemistry` after the third. Adding three plural examples also predicts `robots`
and `cafés` without losing question extraction. All four held-out cases pass in
both modes (8/8). Supplying `plural mouse → mice` retains the learned `mouses`
hypothesis and reports ambiguity, with the counterexample attached to that rule.
This is a diagnostic conflict, not successful exception resolution.

Limits: 256 base units per text; only the most recent 16 prior observations are
searched for new triples; at most 128 retained rules per context/mode; new rules
are assessed against at most 128 prior/current observations. All observations
remain stored even when these search budgets are exceeded. Any incomplete
search is persisted for that context/mode and subsequent results are `bounded`,
with candidates still available. This implementation does not learn arbitrary
rules, meanings, or chemistry facts from raw passages. More data can introduce
spurious overlapping hypotheses and ambiguity; the small experiment is not a
large-dataset accuracy claim. The separate recursive hierarchy learner remains
available; this adaptation layer aligns at the underlying numerical sequence
level and does not claim to discover semantic word/sentence stages.

### Recursive raw-text relationships experiment

`recursive_text_patterns.py` trains on `text`/`source` observations, with no
supplied outputs, concept labels, word tokenizer, or installed heating grammar.
It uses the existing repeated-pair learner to construct numerical constituents
recursively, then applies common-boundary and LCS sequence alignment at the base
level and at each discovered constituent depth. Recurring frames link variable
spans through shared numerical anchors; at least three distinct observations must
support a frame. Depths are learned hierarchy depths, not hand-labelled word or
sentence stages. Corpus observation boundaries are still supplied by the caller.

Older frames survive history-inclusive updates and are reassessed against the
expanded corpus. All raw observations and hierarchy/frame versions persist.
Finite missing-span candidates come from learned constituents, contiguous shared
anchors, and observed variable bindings. Prediction binds completed numerical
sequences against those frames. All matching candidates remain visible; the
preferred subset uses a programmed heuristic: most literal anchors, then shortest
completion. This is a structural language experiment, not grounded meaning,
causal reasoning, or arbitrary raw-text question answering. Agreement does not
establish correctness. No LLM or external provider participates.

The first UI panel trains raw observations, predicts one `<mask>` span, and shows
its learned structure. API actions: `recursive_text_train` (observations, context,
mode, include_history), `recursive_text_predict` (text, context, mode), and
`recursive_text_inventory` (context, mode). History is included by default;
`include_history=false` starts a separate current version while retaining old runs.

Run `python recursive_text_demo.py` to reproduce the experiment. Three supplied
sentences (`the stove/fire/sun heats water.`) predict `heats` in `the candle
<mask> water.` and `water` in `the candle heats <mask>.`, plus a Unicode subject
control. None of the completed test sentences occur in training. All 3 cases pass
in each representation (6/6). Adding three `cools` observations preserves both
patterns and makes the missing action ambiguous. A semantic negative control
(`the ice heats <mask>.`) can still complete `water`: it shows directly that
structural transfer does not verify physical reality. Prediction writes no memory.

Limits: history plus batch at most 32 observations, each at most 256 base units;
64 constituent merge rounds, depth at most 16; at most 256 pair comparisons
across representation levels, 128 relational frames, 1,024 retained candidate
spans of at most 32 base units, and 8,192 frame matching calls per query. The
underlying binder also has its existing expansion and binding limits. Truncated
frame/candidate/query search produces `bounded`, preserving evidence and any
partial candidates. This small synthetic test does not demonstrate large-corpus
accuracy or discovery of unrestricted semantics. Boundary and LCS induction are
a separate programmed relational operator layered over recursive pair grouping;
we have not shown that one universal operator alone learns every abstraction.

Inspection also exposes all learned constituents as numerical and readable spans,
readable relational frame segments, and whole-corpus coverage counts. No one
word is chosen as the training target: every supplied sequence is retained and
participates in discovery. Recurring constituents can cut across words or spaces;
retaining all text is not proof that every word or its meaning was discovered.

### Knowledge behavior learning and higher behavior states

`knowledge_behavior.py` learns state transformations from recorded before/after
observations, rather than just completing text. It also learns recurring paths
of those transformations from supplied trajectories, using learned behavior IDs
as higher states. No heating law, entity catalogue, action workflow, phase order,
or coefficients are installed. The demo's numbers and entity names are synthetic;
its programs and recurring order come from the observations.

This is still bounded program induction. Its programmed operators are field copy,
observed constants, fitted unary affine arithmetic, binary addition/subtraction/
multiplication, and character-sequence alignment. Complete state programs are
assembled from independently matching field expressions. Strings constant across
an inducing triple become learned applicability conditions; changing entity
strings can transfer by copy or sequence rules. Three distinct matching input
records are needed for eligibility. This does not discover arbitrary operators.

All observations and models persist, including unsupported outcomes and
counterexamples. Contradictory outcomes contribute separate one-step candidates.
Inventory shows supporting and conflicting observation IDs. Recurring behavior
paths require evidence from three distinct starting states. Every intermediate
state and contributing model/path ID is returned. Paths whose component models
have counterevidence return `contested` if they otherwise agree on one result.
Path applicability is checked at every step. Predictions never execute external
actions, call an LLM, or write memory.

API: `knowledge_behavior_observe` (before, after, source, context), `knowledge_behavior_predict`
(state, context), `knowledge_behavior_learn_episodes` (episodes, source, context),
`knowledge_behavior_predict_path` (state, context), `knowledge_behavior_inventory` (context). The first
UI panel exposes episode training, one-step predictions, composed predictions,
and inspection. `python knowledge_behavior_demo.py` reproduces the checks.

In three synthetic trajectories, values change by +5 and then double, while
supplied phase strings change from start to middle to end. Three unseen starting
values/entities pass both steps (3/3 trajectories, 6/6 step outcomes). A separate
cross-field experiment learns x+y from three observations and predicts 107 from
x=100,y=7 (1/1). A contradictory outcome is retained, produces one-step ambiguity,
and marks the old composite path contested. No causal or physical law is claimed.

Bounds: 1..6 integer/string fields; integer magnitudes at most 10^9; strings at
most 128 characters; prior triple-search window 12 observations; 64 assembled
programs per triple; 128 retained models per context; 3..8 trajectories per batch,
each with 3..5 states; 32 enumerated model paths per observed trajectory. Existing
sequence bind limits also apply. Window/model/path truncation remains flagged
for the context and predictions are `bounded`. All evidence remains stored even
when search is incomplete; evidence assessment scans stored observations.

This layer currently receives structured observations. Automatically extracting
state changes, conditions, and measurements from arbitrary prose through the
recursive raw-text hierarchy is unfinished. It therefore demonstrates learned
behavior and one higher composition level, not a completed byte-to-universal-
meaning learner or one proven universal learning operator.

### Learning behavior from ordered text descriptions

`text_behavior_learning.py` bridges whole text observations to behavior learning
and renders predictions back into descriptions. The caller supplies trajectories
of observed descriptions, not named entity/action/value fields. A generic,
lossless codec splits canonical integer runs and JSON-encoded surrounding text
spans, with positional field names only. Empty spans are retained. No installed
start/middle/end grammar, warming rule, or entity catalogue is used. Integer
recognition is programmed lexical structure, not itself a learned semantic role.
Text without integers becomes one lossless span and learns sequence changes.

Raw text also trains the existing recursive constituent/frame layer; the
positional codec supplies the alignment used by the behavior learner. Specific
transformations and recurring trajectories are learned from the examples. This
is an explicit bridge of two mechanisms, not a claim that compression alone has
discovered measurement roles. String behavior currently aligns character numbers
even when raw hierarchy discovery is in UTF-8 byte mode.

API: `text_behavior_learn` (episodes, source, context, mode),
`text_behavior_observe` (before, after, source, context, mode),
`text_behavior_predict` (text, context, mode, path), and
`text_behavior_inventory` (context, mode). The first UI panel accepts one state
description per line, trajectories separated by blank lines, and can predict the
next description or learned path. All source text batches and derived states
persist; conflicting descriptions remain visible. Inference writes no memory.

Reproduce with `python text_behavior_demo.py`. Three trajectories such as
`water: start 10 → water: middle 15 → water: end 30` teach text changes and
arithmetic jointly. `copper: start 70` predicts `copper: middle 75` and then
`copper: end 150`. Three unseen subjects/values pass in each raw representation
(6/6 trajectories; 12/12 next/final outputs), including Unicode and negative
values. Text-only trajectories teach `asleep → awake → walking` for an unseen
subject in both representations (2/2). A separate two-measurement text test
predicts `new sample: 107 with 7` from `new sample: 100 with 7` (1/1).
These are synthetic regular descriptions, not verified scientific outcomes.

The generic behavior assembly budget is now 64 programs per inducing triple
(previously 32), sufficient to preserve the competing equivalent programs in the
two-measurement test. Other behavior limits remain. Text states are at most 128
characters and 256 raw base units, with at most two canonical integer runs of
magnitude <=10^9. Decimals remain text. Number format changes are not inferred.
Each episode-learning batch contains 3..8 trajectories of 3..5 descriptions,
with at most 32 total descriptions. Raw constituent discovery is versioned per
trajectory batch; old versions remain. Single-pair updates extend the current raw
corpus subject to its 32-observation bound. Behavior evidence is cumulative within
context/mode and follows its existing search windows. Structural discovery can
be bounded independently of a successful behavior fit; both statuses are exposed.

This is not unrestricted prose understanding: trajectory boundaries/order,
lexical number recognition, and finite operator families remain supplied. It
cannot yet find arbitrary events, implicit quantities, causes, semantic roles,
or observation order in an unstructured passage. Text-only predictions such as
an unseen robot becoming awake/walking show structural transition transfer;
they do not verify whether those events are physically possible.

### Role alignment experiment

Run `python role_learning_demo.py`. `Engine.roles` learns actor/action/object
alignments using the existing numeric byte/character text bridge. The role labels
are supervised; token positions and affixes are induced from three diverse
examples per wording form. No English grammar or LLM calls are installed.

API actions: `role_learn` (examples, optional context), `role_parse` (text,
optional context and level), `role_evaluate` (held-out examples, context, level).
Each example has `text` and a `record` with single-token string fields `actor`,
`action`, and `object`. Evaluation rejects sentences present in training memory.

The synthetic benchmark tests eight unseen sentences at each representation
level: new combinations, reversed roles, new entities, and trained active/passive
forms. Untrained longer wording returns unknown; contradictory alignments return
ambiguous. Same-shape arbitrary words can still receive template assignments: this
is structural generalization, not demonstrated causal or general understanding.

### Relationship coherence after role prediction

Run `python coherence_demo.py`. `Engine.coherence.inspect` connects role parsing
with bounded membership traversal and capability checks. Knowledge consists of
explicit supplied assertions with source labels; no animal facts are installed.

API actions:

- `coherence_observe`: `assertion`, `source`, optional `supersedes` evidence ID.
- `coherence_check`: role `record`, optional knowledge `context`.
- `coherence_inspect`: `text`, optional `role_context`, knowledge `context`, `level`.

Membership assertions have `kind: membership`, `subject`, `class`, `context`.
Capability assertions have `kind: capability`, `subject`, `action`, `object`,
boolean `allowed`, `context`. A null context is a general default; a string names
an explicit context. Capability object `*` matches any object. Labels match
exactly; synonyms and free-prose facts are not automatically extracted.

The programmed default precedence is matching context, nearer subject in the
membership graph, then exact object over wildcard. Opposing evidence at the same
precedence remains `contested`. Results are `supported`, `conflict`, `unknown`,
`contested`, or `bounded`. A conflict includes a suggested negative assertion;
it does not invent a substitute actor/action, automatically rewrite the sentence,
or insert a new fact. This checks consistency relative to active evidence, not
whether a statement happened in the real world. Scope is finite defaults, not a
complete logic for universal negatives, quantifiers or contradictory taxonomies.

Explicit revisions must target the same assertion and context, preserving the
old record. Inference never updates evidence. Limits: 512 active evidence records
and 128 reachable membership labels; exceeding limits returns `bounded`.

### Reuse the whole model in another application

Install from this repository with `python -m pip install ./b-stae` (Python 3.10+).
The installed SDK keeps the legacy implementation private under `bstae._core`;
existing local scripts retain their imports. Core learning needs no external Python
packages. Optional features: `pip install './b-stae[web,plots]'`.

```python
from bstae import Model

examples = [
    {'text': 'cat pushes box', 'record': {'actor': 'cat', 'action': 'push', 'object': 'box'}},
    {'text': 'dog lifts cart', 'record': {'actor': 'dog', 'action': 'lift', 'object': 'cart'}},
    {'text': 'bird kicks ball', 'record': {'actor': 'bird', 'action': 'kick', 'object': 'ball'}},
]
with Model() as model:
    model.learn_roles(examples)
    model.observe_relationship(
        {'kind': 'capability', 'subject': 'cat', 'action': 'speak',
         'object': 'English', 'allowed': False, 'context': None},
        source='my supplied evidence',
    )
    result = model.predict('cat speaks English')  # conflict relative to evidence
    model.save('trained_model.sqlite3')

# Independent memory copy; training this instance leaves the checkpoint intact.
with Model.load('trained_model.sqlite3') as model:
    result = model.predict('box pushes cat')  # roles predicted; capability unknown
    roles = model.request('role_parse', text='box pushes cat')
```

`Model(database='working.sqlite3')` opens persistent working memory.
`Model.load(checkpoint, database='new_working.sqlite3')` loads into a new working
file. Save refuses to overwrite files; load refuses existing working destinations.
The checkpoint contains all SQLite-backed training examples, models, relationship
evidence, revisions, learned paths and provenance from existing components.
Transient execution traces, Python callbacks, API credentials and runtime byte
objects are not serialized. The SDK does not make unsupported tasks universal.

`model.request(action, **payload)` exposes every existing Application action;
`model.components` exposes the full Engine for specialized APIs such as numeric,
text, question, behavior, multimodal and bounded execution work. Actions stay
explicit: web/provider operations require their optional dependencies and existing
configuration. Loading and ordinary local prediction make no external calls.
Use one model/SQLite connection per thread. Model context managers close resources;
SDK calls after close raise a clear error. This is the initial 0.1 SDK interface.

### Shared concept experiment across modalities

Run `python shared_concept_demo.py`. This explicitly aligns red/green/blue labels
with text examples, RGB patches, and assigned pure tones. Three distinct examples
per label/modality support a local exemplar classifier. Nine new raw inputs test
wording, patch dimensions/brightness and tone amplitude/phase/duration. The
synthetic benchmark is not human speech or real object recognition. Correspondences,
including tone-to-color assignments, are supplied supervision, not discovered alone.

API: `shared_concept_observe` (`concept`, `value`, `source`, optional `context`),
`shared_concept_predict` (`value`, optional `context`), `shared_concept_inspect`
(`values`, optional `context`). Available through `Model.request` and
`Model.components.shared_concepts`; evidence survives SDK checkpoints.

Programmed encoders: 128 hashed word-count features (order insensitive), RGB
channel means/deviations (spatial information lost), and normalized spectral probes
at 100..1600 Hz (tones, not speech). Learned acceptance radii use within-label
leave-one-out nearest distances. Near-ties return ambiguous; identical input with
opposing labels returns contested; no candidate within its radius returns unknown.
Minimum support is three distinct raw inputs, not repeated submissions. Limits:
512 matching examples per modality/context, 512 text characters, 4096 pixels,
32..4096 PCM16 samples at 4..48 kHz. Feature version and source are stored.
Inference does not train, call a provider or modify memory.

Feature extraction, invariances, radius multiplier and tie threshold are programmed;
labels, exemplars and radius values come from data. Hash collisions, broad training
spread and discarded spatial/temporal structure can cause false matches. This is a
reusable shared-label experiment, not general understanding.

### Larger synthetic language generalization benchmark

Run `python synthetic_generalization_benchmark.py --output /path/to/new-empty-directory`.
This generates 12,000 records: 9,600 labeled training sentences and four held-out
sets of 600 each. Splits test new combinations (whole role triples absent from
training), unseen entity labels, unseen regular verb stems, and untrained wording
including punctuation, negation and question forms. This measures role extraction,
not truth, passage reasoning or comprehension of negation. Six supplied form groups
are trained in batches of up to 32 with the unchanged hypothesis language.

Fresh models use 3, 18, 30, 300, 3,000 and 9,600 training examples. The same test
sets are used at each stage; no hyperparameters are tuned to their answers. A
fixed-form control tests 3..1,600 active-form examples. The benchmark writes JSONL,
metrics, examples of failures and a reusable SQLite checkpoint. Exact sentence
retrieval scores zero because training/test sentences are disjoint. Fixed-position
extraction supplies a second baseline. Compiled parse indexes group identical
hypotheses for speed while retaining every evidence ID; writes invalidate indexes.

Observed seed-20261002 result: new combinations/entities/verb stems each reach
100% once all six forms have three examples (18 total), then plateau through 9,600.
Untrained wording remains 0%, with 200 wrong punctuation predictions and 400
unknown outputs. More repetitions of covered templates do not broaden grammar.
The fixed-form control reaches 100% on its covered form with three examples and
also plateaus. These are constrained synthetic results, not an independent natural
language benchmark or a demonstration of general understanding.

### Claims, denials and questions

Run `python claim_learning_demo.py`. `Engine.claims` learns role alignments plus
supplied `mode` (`assertion` or `question`) and boolean `polarity`. Training is
supervised: each 3..32-example batch has one mode/polarity, while actor/action/object
values vary. Positive, negative and question grammar is not selected by keyword
rules. An initial experiment uses six form groups and 18 labeled examples.

API actions:

- `claim_learn`: `examples`, `source`, optional `context`. Each example contains
  `text` and `record` with actor/action/object/mode/polarity.
- `claim_parse`: `text`, optional language `context`, `level` (byte/character).
- `claim_inspect`: `text`, optional `claim_context`, knowledge `context`, `level`.

Terminal full stops and exclamation marks are stripped; a terminal question mark
is kept as a separate token. Interior punctuation is unchanged. This programmed
normalization prevents punctuation from becoming an entity label, but does not
handle quoted passages, abbreviations, multiple sentences or arbitrary punctuation.
Original sentences, supplied labels, source references and linked bridge example
IDs are preserved. A question mark alone does not assign question mode: without
alignment evidence for that form, the parser returns unknown.

Negative assertions compare their polarity against the deciding capability state;
positive and negative questions return yes/no only when that evidence is decisive.
Unknown, contested and bounded knowledge stays unresolved. A conflict suggests
an assertion matching the stored evidence; it does not rewrite memory. This is
consistency with supplied capability evidence, not verification that an event
occurred. "Never" is a synthetic negative label here, not a learned temporal
quantifier. Double negation, nested negation scope and unrestricted grammar remain
unsupported.

`Model.predict` / `coherence_inspect` use the claim layer whenever that language
context has claim training, with no fallback to polarity-blind roles. Contexts
without claim training keep the legacy role behavior; raw `role_parse` remains the
original template API. New claim memory is checkpointed; loading older SDK
checkpoints recreates missing additive schema tables without modifying originals.

Expanded synthetic result: 1,200 unseen sentences, evaluated at both byte and
character levels, give 2,400/2,400 correct role/mode/polarity predictions within
the six trained forms. The previous 200 terminal-punctuation failures are fixed
through `claim_parse` (a regression test, not an independent test). Unsupported
wording and conflicting labels remain explicit. See `examples/claim_learning_results.json`.

### Compose separately learned behaviors on unseen goals

Run `python behavior_composition_demo.py`. `Engine.composition.solve` performs
bounded breadth-first search over eligible `Engine.behavior` models from explicit
contexts. Each model must have three distinct supporting inputs, no contradictory
applicable observations and no learner bound flags. Its learned schema and guards
select applicable states. The goal, state fields and allowed contexts are supplied;
no complete trajectory or action ordering is required during training.

API `behavior_compose`: `initial`, `target`, `contexts`, optional `max_depth` (0..8,
default 4), `max_nodes` (1..512, default 128). Maximum: eight distinct contexts and
128 assessed models. It searches learned transformations, replays the selected
plan from the initial state, and checks exact structured-target equality. Reaching
a target under fitted hypotheses is not verified physical execution or causal
truth. Knowledge gaps, counterevidence, unreachable goals and budget exhaustion
remain separate outcomes. No LLM calls are made.

Successful plans are checkpointed with dependency fingerprints and integrity
digests. Every reuse reassesses the evidence and replays the path. Changed
observations invalidate reuse; contradictory models are excluded. A search goal
can choose between compatible hypotheses, so success is conditional on the supplied
goal and finite learned operator language, not an independently discovered intent.

The numeric experiment supplies only six separate pairs: three supporting +5 and
three supporting x2, in disjoint entity/input sets. No complete episodes are stored.
It composes them correctly for 200 new initial states with new entities, including
values outside the training range. Tests also compose independently learned text
suffixing and bracketing on unseen strings, check depth/node bounds and wrong goals,
and verify that contradictory feedback stops accepting the cached solution.

### Conditional transfer to new representations

Run `python transfer_learning_demo.py`. `Engine.transfer` learns one-to-one copy
bindings between aligned domain and canonical state fields, then reuses learned
behavior composition under explicit observed conditions. Three distinct aligned
states are required. Ambiguous field bindings are not guessed. Field names alone
do not determine semantics; correspondences, requirements and allowed behavior
contexts are supplied by training. No causal analogy, unit conversion or universal
understanding is inferred from coincident numbers.

API actions:

- `transfer_learn`: `examples` (domain/canonical state pairs), `requirements`
  (1..8 scalar conditions), `contexts`, `source`.
- `transfer_solve`: domain `initial` and `target`, learned `adapter` ID, observed
  `conditions`, optional composition `max_depth` and `max_nodes`.
- `transfer_feedback`: `adapter`, aligned `example`, `source`.

Missing required conditions/state fields return `needs_information`; conflicting
conditions or unexpected fields return `not_applicable`. Counterevidence disables
the adapter while retaining its evidence and feedback. Later matching examples do
not silently reactivate it. The underlying behavior models also retain independent
conflict checks. Successful responses include domain and canonical plans, source,
conditions and a replayed structured goal. They remain hypothetical predictions,
not verified actions. Memory survives SDK checkpoints.

Synthetic evaluation: six independently learned behavior pairs plus nine aligned
state pairs transfer +5/x2 composition to 300 new states in three renamed schemas.
The names represent simulations, not measured tank/stock/queue physics. Tests also
transfer text suffix/bracket composition through a new message/stage schema. This
adds representation transfer and explicit applicability/knowledge-gap handling;
unlabeled relation discovery, physical grounding and broad semantics remain open.

### Chatbot

Start `python app.py` from `b-stae`, then open `http://127.0.0.1:8765/chat`.
The existing learning workspace stays at `/`. The chatbot has conversation
history, greeting responses, exact reply teaching, and an optional sample lesson
for learned claims/denials/questions. It uses no LLM or external service.

Greetings/help are explicitly supplied interaction policy, not autonomously learned
language. “Teach a reply” saves a normalized phrase/response association; casing
and terminal periods/exclamation marks are normalized, while question marks stay
significant. Different responses for the same phrase are flagged as ambiguous.
Unfamiliar inputs report a knowledge gap; conversational history is saved but does
not automatically train the model, resolve references or supply reasoning context.

Sample lesson loading is explicit. It trains the six claim forms with synthetic
examples and a supplied cat/speech capability state under `chat-demo`. Responses
are relative to stored relationship evidence. Saved reply teaching does not verify
factual accuracy. Unknown facts, conflicting evidence and reasoning bounds remain
visible. This is a prototype chatbot frontend for current model capabilities,
not an open-domain assistant or a production multi-user service.

API: `chat_send` (text up to 512 characters, optional conversation ID and context),
`chat_history`, `chat_new`, `chat_teach` (text/reply/source), `chat_demo`.
Available through `Model.request`. Conversation IDs are random; history returns
at most the last 100 messages. Replies, messages and trained sample memory survive
SQLite checkpoints. Existing HTTP token/host/origin protection applies unchanged.
The access token is kept in browser-tab session storage; it is not written to
model memory. Conversation and lesson selections also persist within the tab.
### Predict a sentence's first word

`text_first_predict` accepts `text` containing the words following the missing
first word, plus optional `context` and `window` (1–6). It uses the observations
from `text_gap_learn`, restricting candidates to document beginnings or words
following `.`, `!`, or `?` (with optional quotation marks). These are simple
punctuation boundaries, so abbreviations may be interpreted as sentence ends.

Example request: `{"action":"text_first_predict","text":"studies matter during experiments."}`.
After learning `Chemistry studies matter in laboratories.`, the candidate is
`chemistry`. This new complete sentence reuses observed local right contexts.
Tied candidates return `ambiguous`; unmatched contexts return `unknown`.
No LLM is called, and prediction does not update training memory. This is local
context generalization, not evidence of universal meaning or unseen knowledge.

### Learned text transformations with example-free inference

`text_transform_learn` accepts 3–32 `examples` and 1–100 `validation` pairs,
each containing `input` and `output`, plus optional `context`. Generic sequence
alignment learns fixed words, variable spans and output ordering. Validation
inputs must differ from training inputs; all validation pairs must pass before
the model is saved. Validation demonstrates only the tested structural transfer.

For example, train on Chemistry/Biology/Physics pairs of the form `Chemistry
studies matter.` → `Chemistry is the study of matter.` and validate on `Astronomy
studies celestial bodies.` → `Astronomy is the study of celestial bodies.`.
Then `text_transform_predict` with `text: "Geology studies rocks."` generates
`geology is the study of rocks.` using the fitted template and current input.

Inference selects only fitted parameters from storage, never training examples.
`TextTransformModel.export()` also supports a fresh standalone model containing
only those parameters, with no database. The test removes audit training records
and verifies generation still works. Conflicting models remain ambiguous;
unmatched inputs remain unknown. All text is case-folded. This supervised
hypothesis language is programmed, while its specific templates are fitted from
examples. It does not learn facts about geology from the grammar or answer
`What is geology?` without supplied knowledge. It uses no LLM.

### Compose learned relationships across supplied statements

`relationship_compose_answer` accepts `facts` (1–24 statements), `question`,
optional `context`, and search bounds: `max_depth` (0–4, default 2), `max_facts`
(up to 96, default 48), `max_expansions` (1–5000, default 1000).

First fit a binary rule with `text_transform_learn`: paired examples of `A
studies B. B includes C.` → `A studies C.`, using different entities in at least
three examples and separate validation pairs. Fit the question relationship with
`text_relation_learn`: `A studies B.` / `Which field studies B?` / `A`.
Neither `studies` nor `includes` has a built-in handler. Equal variable columns
across examples become shared slots; inference requires the middle entity to
match in both statements. Correlated training columns can still mislead this
limited template learner, so varied examples and held-out validation matter.

With supplied facts `Chemistry studies matter.` and `Matter includes substances.`,
the question `Which field studies substances?` yields `chemistry` under that
learned rule. Chemistry and substances are absent from the demonstration's
training examples. Inference uses fitted rule parameters, current facts, and a
learned QA template; it does not read the retained training-example records.
Derived statements include parent facts, depth and model IDs in `trace`.

The rule itself is a supervised hypothesis: `studies` plus `includes` does not
universally entail specialized study in ordinary language. This experiment
shows structural composition under an explicitly learned rule, not proof of
semantic entailment, independent discovery of facts or universal intelligence.
Conflicting answers remain `ambiguous`; missing bridges and unmatched relations
return `unknown` within the depth bound. Exhausted fact/expansion/search budgets
return `bounded` even when provisional candidates exist. `verified` stays false.

### Learn passages, then answer without facts in the request

`passage_learn` accepts raw `text`, `source`, and optional `context`. It splits
punctuated sentences, retains them with sources, and recognizes variable spans
using previously learned transformation and question templates. Unrecognized
sentences remain stored but do not participate in inference. Learn the templates
first. Optional supervised paraphrase rules can normalize different wording,
for example an example-trained `investigates` → `studies` transformation.

`passage_answer` accepts only `question`, optional `context`, `max_depth`, and
`max_expansions`. It reads recognized statements from earlier passages, composes
learned rules, and returns answers with a derivation trace and source provenance.
It never looks up stored answers or reads the retained supervised training-pair
records. It does read persistent knowledge facts: memory is necessary to answer
questions about content supplied previously. It cannot invent missing knowledge.

`passage_evaluate` accepts `cases` with `question`/`expected`. It rejects duplicate
questions and exact supervised QA training questions and reports both composition
results and a depth-zero direct-answer baseline without updating memory. A small
synthetic test scores 3/3 versus 0/3 direct answers on new Chemistry/Botany/Ecology
questions requiring two earlier statements. This measures limited structural
composition, not general natural-language reasoning. Negative tests cover
missing bridges, conflicting answers, unsupported relations, persistence and
context isolation. Recognition is supervised; raw-text semantic learning remains
unimplemented. Sentence splitting uses punctuation and can misread abbreviations.

Fitted variable spans exclude sentence punctuation absent from their training
values. This prevents unary paraphrase templates from accidentally swallowing
multiple statements. Previously fitted models must be retrained for this constraint.
More than 24 distinct recognized statements in a context returns `bounded`; no
facts are silently dropped. Passage ingestion accepts up to 64 sentences, each
up to 64 tokens, within a 20000-character limit.

### Unlabeled recurring frames and variable links

`unlabeled_pattern_learn` accepts 3–64 raw `passages` and optional `context`.
There are no output, question, relation or missing-token labels. It groups texts
by token length, discovers common literal positions and fits equality links
between variable columns across at least three distinct passages. The programmed
hypothesis language is fixed-length positional frames; its literal words and
repeated-variable positions are learned. Two constant word anchors and three
observed values per varying column are required. Unsupported variation leads to
abstention rather than a guessed rule. No grammar or relation-name handlers exist.

Example raw training passages:

- `Mira carries amber. Later Mira stores amber.`
- `Kito carries jade. Later Kito stores jade.`
- `Sena carries silver. Later Sena stores silver.`

`unlabeled_pattern_predict` accepts `model_id` and a `text` containing one
`<mask>`. `Taro carries copper. Later <mask> stores copper.` predicts `taro`:
the word is absent from training but present elsewhere in the current input.
Reversed-position training learns reversed links, rather than a fixed copying
position. A fitted model can run independently with only exported parameters;
removing stored training passages does not affect prediction. Contradictory
bindings return unknown; unresolved variable slots cause abstention. Competing
predictions remain ambiguous. Frequency/support are not calibrated probabilities.

`unlabeled_pattern_evaluate` accepts `model_id` and `cases` with `text`/`expected`.
Labels are used only for scoring, never for fitting. It rejects exact completed
passage leakage and duplicate cases, compares exact full-frame matching and
most-frequent-word baselines, and reports whether expected words were unseen.
Run `python unlabeled_pattern_demo.py`: three synthetic completions score 3/3,
versus 0/3 for each baseline, without learning updates or LLM calls.

This demonstrates narrow equality-pattern transfer, not understanding why
someone carries or stores something, independent fact discovery, free-form QA,
or universal generalization. Passages must align in token length; varying-length
phrases and arbitrary prose remain unsupported. Learned literals and variable
constraints are still memory in the ordinary sense; prediction reads fitted
parameters, not raw training examples. Raw passages are retained only for audit
and held-out baseline evaluation. Each passage is limited to 96 tokens and 4000
characters. These models are not automatically used by the passage QA subsystem.

### Variable-length unlabeled span learning

`unlabeled_span_learn` accepts 3–32 raw `passages` and optional `context`. Supply
a coherent batch showing one recurring structure with different entities and
phrase lengths. Generic sequence alignment discovers literal anchors, variable
spans, and equal variable columns. No missing-span, question, relation or answer
labels are supplied. At least two fixed word anchors, three distinct values per
varying span, and one repeated variable are required. Heterogeneous prose may
produce no supported pattern; this is not unrestricted raw-text understanding.

Example training passages vary both subject and object length:

- `Mira carries amber. Later Mira stores amber.`
- `The red robot carries a green basket. Later the red robot stores a green basket.`
- `A farmer carries heavy books. Later a farmer stores heavy books.`

`unlabeled_span_predict` accepts `model_id`, masked `text`, and optional
`max_expansions` (1–10000). For `The young student carries a blue bag. Later
<mask> stores a blue bag.`, it predicts `the young student`. Longer subjects and
objects are allowed, and their words need not occur in training. Only fitted
parameters and current input are read. A mask stands for one entire learned
span or one literal, not an arbitrary substring within a span. Reversed-link
training learns reversed relationships; inconsistent bindings return unknown.
Competing consistent predictions return ambiguous. Exhausted search budgets
return bounded, retaining any provisional candidates without declaring success.

`unlabeled_span_evaluate` accepts `model_id` and held-out `cases` with
`text`/`expected` and rejects exact completed-passage leakage and duplicates.
Four synthetic completions with new words and lengths score 4/4 versus 0/4
for exact-match and word-frequency baselines. Labels are used only for scoring.
Persistence and inference after deleting audit training records are tested.

This is learned repeated-span structure, not semantic understanding. Alignment
anchors and minimum span lengths reflect the training examples; rare/optional
forms, misleading shared words and varied prose remain limitations. The general
alignment/search hypothesis language is programmed, while its fitted literals,
boundaries and repeated-variable links are learned. This learner remains a
separate experiment and is not yet connected to passage question answering.

### Connect unlabeled span frames to passage question answering

1. Fit the recurring passage frame with `unlabeled_span_learn` and unlabeled raw
   passages, as above. Preserve its `model_id` and `context`.
2. Call `span_question_learn` with `span_model_id`, matching `context`, 3–32
   `examples` and 1–32 held-out `validation` records. Each record contains
   `passage`, `question` and `answer`. The mapper binds the already fitted span
   frame, then learns question literals and answer links onto those span slots.
   It does not independently install a grammar for `stores` or any other verb.
3. Store a new raw passage with `passage_learn`. Later call `passage_answer`
   with only a question and context. It now combines the existing sentence-rule
   pathway with the span-question pathway and preserves conflicting answers.

For example, teach mappings from the original three training passages to `Who
stores amber?` → `Mira`, and analogous questions about the robot and farmer.
Validate on an entirely new teacher/chalk passage. Store `The young student
carries a blue bag. Later the young student stores a blue bag.`. Then `Who stores
a blue bag?` answers `the young student`, with source, question model ID, span
model ID and variable bindings in its derivation trace. Other example-trained
mappings support `What does the young student store?` and `Which person stores
a blue bag?`. These wording families are explicitly taught, not invented by the
system. A test also trains `ships` instead of `stores` with the same generic code.

No stored training answers are looked up at inference. Removing audit training
records does not alter answers. The system still reads earlier stored passages
and fitted parameters. Span recognition is unlabeled; question mapping remains
supervised. It requires the whole passage to fit a known recurring frame and
therefore may reject an independently true statement whose repeated entities do
not satisfy that frame. It is not general semantic reasoning or unrestricted QA.

`passage_evaluate` now also rejects exact span-question training questions.
Its depth-zero direct baseline uses only the older sentence-template pathway,
excluding the new span pathway; it is a deliberately limited comparator. Three
held-out questions score 3/3 versus 0/3 for that baseline. Repeated questions or
completed validation passages from span-model training are rejected. Conflicting
passages/models yield ambiguous answers; exhausted search limits yield bounded.
Span QA supports passages of up to 96 tokens/4000 characters and at most 256
passage/model comparisons in one context. Longer stored passages can still use
the older sentence pathway, but are unsupported by this span pathway.


### Teach text, image files and voice recordings

Install local media adapters with `python -m pip install ".[media]"` from
`b-stae`, start `python app.py`, and open http://127.0.0.1:8765/learn.
The page accepts text, PNG/JPEG images and mono/stereo PCM16 WAV recordings.
Use the same concept label and collection across modalities. Teach at least
three distinct examples per concept per modality before testing new inputs.
Repeating an identical file does not supply independent support.

Files are limited to 700 KB; images to four million pixels; WAV recordings
to ten seconds at 4–48 kHz. Images are reduced to an 8×8 spatial RGB descriptor.
Audio is represented by averaged spectral-band and zero-crossing features.
These CPU adapters provide labeled similarity experiments, not general object
recognition or speech transcription. An optional user-supplied audio transcript
is stored as a separate text example under the same concept; no transcript is
generated automatically. No external service or model is called.

SDK actions: `media_observe` takes `concept`, `value`, `source`, and optional
`context`; `media_predict` takes `value` and optional `context`; `media_inspect`
takes 1–8 `values` and optional `context`. A value is plain text or an object
`{"kind": "image", "data": "BASE64_FILE_BYTES"}` or
`{"kind": "audio", "data": "BASE64_WAV_BYTES", "transcript": "optional words"}`.
Predictions retain evidence and may return unknown, ambiguous, contested or
bounded. A transcript prediction is reported separately from acoustic matching.
All stored examples survive the standard SDK save/load checkpoint. Uploaded
training files are retained in SQLite; prediction alone does not store files.
This encoder is versioned separately from earlier synthetic concept experiments.


The chat interface now lives in the top-level `chatbot/index.html`.
Run `python chatbot/run.py` from the repository root to open chat directly
at `/`. See `../chatbot/README.md` for startup and hosting instructions.
