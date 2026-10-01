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

This is an initial coding agent with observable file and syntax results. Syntax
success does not prove behavioral correctness. It does not yet execute project
test suites, create new files, edit multiple files, repair failed code automatically,
or expose an MCP server. Verified evidence persists separately from approved
procedure definitions; neither proposals nor predicted effects are auto-approved.
