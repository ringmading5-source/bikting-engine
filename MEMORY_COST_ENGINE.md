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

This is an initial cost-reduction increment, not the complete research architecture.
It does not yet implement general knowledge applicability, semantic-vector
retrieval, state-dependent plan invalidation, or forward/backward symbolic search.
Approximate retrieval must select candidates for checking, not declare equivalence.

Validation uses mocked provider calls. Evaluate real workloads using total cost
per user-confirmed successful task, including retries and storage/tool overhead.
Exact repeats can avoid calls; novel requests still require the attached LLM.
