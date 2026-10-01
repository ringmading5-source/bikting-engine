# B-STAE cost-reduction engine: first increment

The live engine resolves recognized tasks through registered tools before asking
Gemini for interpretation. This increment extends exact reusable memory to the
bounded summary/comparison worker. It needs no new neural training or GPU.

A text-memory key covers the selected model, the entire provider request
(including instructions and output limit), language, and a memory format version.
The existing knowledge store controls expiry and capacity. Matching concurrent
calls share one provider request; failed and empty outputs are not stored.
Reused text records zero new model calls/tokens and retains model provenance.
Nonempty text is a structural check, not factual verification.

Whole-run reuse is restricted to listed read-only capabilities and scoped by model
and format version. Actionful tools must execute again. Cached interpretation
usage is excluded independently of worker usage, so a new worker call remains
visible in the request's usage report.

This remains a bounded implementation of the research architecture. The relational
retrieval and planning section below describes the next increment. Approximate
retrieval selects candidates for checking; it does not declare equivalence.

Validation uses mocked provider calls. Evaluate real workloads using total cost
per user-confirmed successful task, including retries and storage/tool overhead.
Exact repeats can avoid calls; novel requests still require the attached LLM.

## Relational retrieval and planning

The next increment adds typed facts and procedures via `relationalMemory.js`.
Each record carries a source, explicit operator review, expiry, and context
requirements. Model output is not automatically approved. Exact question aliases
can resolve approved facts; conflicting values stop resolution. Lexical scoring
and deterministic 128-dimensional signed feature hashes rank candidates without
neural training. Similarity alone never authorizes an answer or action.

The planner uses backward goal relevance followed by bounded breadth-first
forward search. Procedures declare exact preconditions and effects over a
bounded scalar state. Returned steps and state are predictions, not execution
claims. Each request recomputes its plan from the supplied observations; there
is no cached state-dependent path to invalidate. This version has no variables,
negation, delete effects, or automatic real-world procedure execution.

Authenticated endpoints (all JSON; `x-bikting-test-token` required):

| Method | Endpoint | Body |
| --- | --- | --- |
| POST | `/api/memory/records` | One fact or procedure |
| DELETE | `/api/memory/records` | `{ "id": "record-id" }` |
| POST | `/api/memory/retrieve` | `{ "query": "refund window", "context": {}, "limit": 5 }` |
| POST | `/api/memory/answer` | `{ "query": "What is our refund window?", "context": {} }` |
| POST | `/api/memory/plan` | `{ "state": { "approved": true }, "goals": { "ready": true } }` |

Example fact:

```json
{
  "id": "refund-policy-v1", "kind": "fact",
  "subject": "refund", "predicate": "window", "value": "30 days",
  "text": "Refund window is 30 days", "source": "policy:v1",
  "review": "approved", "context": { "language": "en" },
  "queries": ["What is our refund window?"], "expiresAt": 1893456000000
}
```

Example procedure:

```json
{
  "id": "prepare", "kind": "procedure", "text": "Prepare an artifact",
  "source": "runbook:v1", "review": "approved", "context": {}, "queries": [],
  "preconditions": { "approved": true }, "effects": { "ready": true },
  "expiresAt": 1893456000000
}
```

When Gemini is attached, `/api/run` checks exact approved fact aliases for simple
text explanations before provider interpretation. Language requirements are
checked. Web mode, task actions, sketches, and project-context requests retain
the existing execution routes. An exact conflict returns a review message with
zero provider calls. Other misses retain normal provider fallback. The standalone
memory answer and plan endpoints work without a model key.

Storage is bounded to 256 records in one versioned aggregate and inherits the
configured knowledge-store TTL. Per-record expiry can shorten that lifetime.
Writes are serialized within a server process; aggregate writes are not safe for
multiple concurrent server replicas without a database transactional record table.
File storage also serializes writes to avoid competing temporary-file renames.
Approval indicates operator review, not independent factual verification.

## Executing task agent

`taskAgent.js` closes the observe → plan → execute → observe loop. It retrieves
procedures through relational memory, invokes only registered executors, checks
fresh preconditions immediately before execution, and replans from observed state
after each verified step. Predicted effects and a tool's success assertion never
advance working state. Missing executors, failed verification, and exhausted
step budgets stop the run. A host can inject an escalation callback for unresolved
work; its response remains a proposal and cannot register or execute a tool.

The initial coding adapter operates on one existing JavaScript file inside a
configured workspace. It supports complete replacement using an expected SHA-256
and `node --check`. It validates candidate syntax before replacement, checks the
written file again, preserves its permission mode, and records verified step
evidence. It does not run the file or arbitrary shell commands. Invalid syntax
leaves the original intact. Workspace path checks reject outside symlinks,
absolute paths and traversal. The HTTP handler serializes coding runs; hash checks
also detect external changes, but are not transactional locks against other
processes or adversarial filesystem mutation. Use one controlled workspace.

Set `BIKTING_AGENT_WORKSPACE` explicitly to enable the coding endpoints. Without
it, the endpoints return a configuration error. Both require the existing token.

| Method | Endpoint | Body |
| --- | --- | --- |
| POST | `/api/agent/propose` | `{ "path": "app.mjs", "instruction": "Set the exported value to two" }` |
| POST | `/api/agent/code` | `{ "path": "app.mjs", "content": "export const value = 2;\n", "expectedHash": "<SHA-256 of current bytes>", "maxSteps": 4 }` |

For a known replacement, call the execution endpoint directly: no model call is
needed. For unfamiliar code, the optional Gemini proposal endpoint reads the
bounded source file and returns unverified content, an explanation, and its
expectedHash. It uses one bounded provider request and records token usage. It
never writes a file. Submit the chosen proposal to the execution endpoint to
apply it under hash and syntax checks. Source inputs for proposals are limited
to 6000 characters, instructions to 2000, and generation to 2000 output tokens.
File replacement is limited to 100000 bytes. Only .js, .mjs and .cjs are supported.

The single-file endpoint reports observable file and syntax results. Syntax
success does not prove behavioral correctness. The project endpoint described
below adds multiple files and registered checks. Automatic repair and MCP serving
remain unimplemented. Verified evidence persists separately from approved
procedure definitions; neither proposals nor predicted effects are auto-approved.

## Project change sets and registered checks

`POST /api/agent/project` extends execution to 1–8 existing or new JavaScript
files. Supply `changes`, each containing path, complete content, and expectedHash.
Use `expectedHash: null` only when a new file must not already exist. Parent
directories must exist. Changes are bounded to 100000 bytes each and 200000 bytes
total. Example:

```json
{
  "changes": [
    { "path": "value.mjs", "content": "export const value = 2;\n", "expectedHash": "<current SHA-256>" },
    { "path": "new.mjs", "content": "export const ready = true;\n", "expectedHash": null }
  ],
  "maxSteps": 6
}
```

The endpoint requires the token and BIKTING_AGENT_WORKSPACE. Configure
`BIKTING_AGENT_TEST_FILES` as a JSON array of at most eight relative test paths,
for example `["tests/value.test.mjs"]`. Clients cannot replace this configuration
with arbitrary commands or test paths. A change set cannot edit its registered
check files. Registered checks run with `node --test`, a ten-second timeout and
bounded output; candidate and final syntax checks use `node --check`. Child
processes receive a minimal PATH environment rather than application credentials,
Node preloads, or inherited test-runner mode. These are trusted project checks,
not a sandbox for hostile code. Use an isolated, controlled coding workspace.

All candidates are staged and syntax-checked before any destination is changed.
Existing files require observed hashes; new files use exclusive creation.
Observed file hashes invalidate syntax/test receipts when files change. A task
is completed only after the configured checks succeed. Without registered tests,
completion covers file equality and syntax only; the response states which checks
were configured and passed. Registered test hashes are checked before/after
execution so altered check code does not establish success.

Failed execution, failed checks or an exhausted task budget trigger rollback of
changes owned by this run. Created files are removed and replacements restored
only while their current hashes match this run's content. Concurrent edits are
preserved and reported as rollback conflicts. Multi-file replacement is not an
atomic filesystem transaction. Step evidence remains historical evidence of that
step, while a separate run record preserves the final failure/rollback or success.
The HTTP handler serializes single-file and project runs together.

This increment supports multi-file changes, new files in existing directories,
and registered JavaScript project checks. It does not yet generate complete
change sets autonomously, repair failures, delete requested files, create
directories, or serve MCP. The earlier single-file proposal endpoint remains
available for unfamiliar code.
