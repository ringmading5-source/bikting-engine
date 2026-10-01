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
