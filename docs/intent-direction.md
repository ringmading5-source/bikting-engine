# Bikting intent direction

The engine should resolve the **meaning of a whole utterance**, independent of its input language, before selecting workers. A word can signal an action, a purpose, a constraint, a reference, or a requested presentation. Its role comes from the sentence and current project, not its spelling alone.

Canonical frame (language-neutral):

```json
{
  "language": "und",
  "actions": [{ "family": "teach", "target": "cells", "order": 1, "negated": false }],
  "purpose": null,
  "constraints": [{ "kind": "audience_level", "value": "beginner" }],
  "reference": null,
  "presentation": { "motion": "animated" }
}
```

An input-language adapter maps local words, morphology, and syntax into this frame. The planner and capabilities consume canonical fields. For example, “build a website for teaching biology” has a build action and a teaching purpose; “build a website, then teach biology” has two ordered actions. “Animations” is a presentation request. It requires an animation capability with concept-faithful states; a generic diagram must not be labeled as a completed animation.

The current deterministic parser covers selected **English** patterns. `language: "und"` means no language was declared. Other languages may reach the model interpretation fallback, but this is not validated multilingual support. To add a language, supply an adapter with examples for actions, negation, scope, purpose, order, constraints, references, and presentation words. Test ambiguous and mixed-language utterances before enabling execution. Unknown meaning or unresolved references should ask for clarification; unavailable capabilities should remain unexecuted.
