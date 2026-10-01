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
