# B STAE vector transition model

This research implementation adds a trainable structured dynamics model to the existing byte executor. It makes no LLM calls. It learns weights from numeric before/after observations, rather than selecting a handwritten transformation for every input.

Run from `b-stae`:

```sh
python -m pip install -r requirements.txt
python vector_experiment.py
python -m unittest discover -s tests -v
```

`vector_model.py` uses NumPy ridge least squares. For each typed relation and behavior it learns an affine mapping from `[1, state, context]` to the next state. It separately learns a backward mapping. Labels choose an operator; labels are not learned language embeddings. State/context encoding is an explicit numeric identity adapter. Numeric context dimensions must retain consistent units and meanings. Goal state affects planning rather than physical dynamics.

Training and validation inputs must be disjoint. Checkpoints, observations with provenance, and verification feedback persist in SQLite. Validation targets do not enter weight fitting. Forward and backward errors are measurements, not calibrated confidence. A forward design without full rank abstains at prediction time. Queries outside training feature ranges abstain; range membership does not prove reliability on nonlinear or shifted data.

The planner explores typed action contracts with numeric preconditions and explicit depth/expansion budgets, suppresses repeated states, and orders the frontier by goal distance. Actions select learned dynamics; this API does not invoke external tools. `vector_verify` compares a caller-supplied observation against a prediction and records the correction. It does not independently authenticate that observation or automatically continue an executed trajectory. Backward reconstruction is a diagnostic, not proof of reversibility or an active planning constraint.

The shared timeline supports all eight routing codes. Its state, code and timing metadata require voice/text/visual renderer adapters. The implementation does not synthesize speech or animations. Checkpoints have no neural language decoder, language understanding or multilingual generalization.

## App API

POST to the existing app endpoint using its current authentication rules. Dispatch actions:

- `vector_train`: `name`, `training`, `validation`
- `vector_predict`: `name`, `state`, `relation`, `behavior`, `context`
- `vector_plan`: `name`, `state`, `goal`, `actions`, optional `max_depth`, `max_expansions`, `output_code`
- `vector_verify`: `name`, `state`, `contract`, `observed`
- `vector_model`: `name`

Transition records contain exactly `before`, `after`, `relation`, `behavior`, `context`, `provenance`. State vectors have 1–64 finite numeric dimensions; context has 1–64 dimensions (use `[0]` for no varying context). Action contracts contain `relation`, `behavior`, `context`, `min`, `max`. The last two fields bound admissible current states.

## Evaluation

The reproducible grid experiment trains on 408 transitions and holds out 78. All coordinate pairs with the selected partition are absent from training across every behavior and context. It measures forward/backward MSE, nearest-neighbor MSE and exact-lookup coverage, and searches for a four-step route from `[0,0]` to `[2,2]`.

The model is itself the affine-regression baseline. Success against retrieval does not establish a new learning algorithm, superiority over an affine model, or general AI. Handwritten grid rules can solve the task exactly. Neural, graph, noisy-data, nonlinear, noninvertible and real-world comparisons remain future experiments.
