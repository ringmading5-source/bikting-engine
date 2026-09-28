# Bikting Engine

A small, dependency-free browser prototype of Bikting as a modular interaction and orchestration system. The current vertical slice accepts text, interprets a request, creates a plan, routes it to a domain module, and delivers structured explanation, visual state, and narration to a workspace.

## Run locally

Requires Node.js 18 or newer. From this directory:

```powershell
node server.js
```

Open <http://127.0.0.1:8000>. The electric motor walkthrough works without an AI service or network connection. Browser speech synthesis is used for optional narration.

## Deploy on Render

Connect this repository to Render and choose **New → Blueprint** to use `render.yaml`. It creates a Node web service with `npm ci`, `npm start`, and the `/health` check. Render supplies `PORT`; the server listens on all network interfaces. Enter `GEMINI_API_KEY` and a separate, randomly generated `BIKTING_TEST_TOKEN` (at least 16 characters) as secrets when deploying the Blueprint. You can also create a Web Service manually with the same build and start commands, then add both secrets in its Environment settings. Optionally set `GEMINI_MODEL` (default: `gemini-2.5-flash`). Never put either secret in GitHub. The UI asks for the test token when you first submit a request; it keeps the token in memory for that browser tab. Without a Gemini key, the server uses the mock interpreter for local testing; `/health` reports which interpreter is active.

The browser submits text to `POST /api/run`. Recognized calculations, plots, conversions, dataset operations, and supported physics relationship explanations run through the intent and relationship engines without Gemini. Requests the built-in parser cannot interpret use one Gemini call for structured interpretation and a brief explanation; the planner then routes execution to registered capabilities. Repeating an identical request on the same server instance reuses its interpretation. Other output providers such as narration remain mock adapters. External accounts and production authentication are not connected. A public Render URL can be opened by anyone who has it; only requests with the test token can reach the model. This shared token is a prototype access gate, not user accounts or a production authentication system.

Requests such as “Build me a website for a bakery” resolve action, target, and relationship locally. `POST /api/intent` returns a small layout sketch while the build runs. With Gemini configured, the engine compiles the exact request and its action relationship into a build prompt and makes one generation call for a self-contained HTML page. The website tool validates the HTML, then shows an intent sketch followed by a sandboxed preview and a download. Invalid or unavailable generation uses a clearly labeled starter page. Repeated identical requests on one server instance reuse the generation result. Without Gemini, the builder produces the starter page directly. This workflow does not publish the website or run generated JavaScript.

The intent resolver records an explicit action, target, and required capability before planning. For example, “Build me a mobile app” requests `artifact.build`, while “Deploy my website” requests `website.deploy`. Because these capabilities have no registered provider, the workspace reports them as unexecuted rather than replacing the requested action with an explanation. Additional action targets need dedicated capability providers to execute.

## Calculations and animation

`GET /api/capabilities` lists available tool properties. Current deterministic calculations include arithmetic, equation plots, statistics, unit conversion, force and force series, numeric ranges, and vector magnitude/dot product. For example: `Calculate dot product of [1,2] and [3,4]` and `Calculate magnitude of [3,4]`.

The visualization tool builds progressive graph frames and relationship-focused states. The workspace can play states automatically, or synchronize them with browser speech when narration is present. This generic renderer can show relationships for different fields, but it is not a detailed anatomical, chemical, mechanical, or historical animation engine. Concept-specific assets and validated field modules must be added for faithful depictions; the renderer never claims that a generic diagram is a complete model of a concept.

The browser now reads the displayed Gemini explanation and each visual step aloud with `speechSynthesis`; it advances the frame after each utterance finishes. Equation plots show labeled axes and progressively revealed points. Plotly.js renders interactive charts when available, with Bikting's deterministic SVG plot as a fallback. Matplotlib would require a separate Python execution environment and is not part of this Node deployment.

`GET /api/visual-tools` lists the visual tool catalog, including each tool's supported artifact forms, domains, runtime, and availability. Plotly.js is bundled for working interactive math and data graphs, with the SVG plot as an offline fallback. Requests needing molecules, maps, 3D scenes, network graphs, volumetric views, or Python figures get an explicit integration requirement; Bikting currently displays a general relationship diagram for those requests and does not claim to have rendered the specialized artifact. Adding a real renderer requires an adapter, appropriate data/assets, and validation before its status changes to `available`.

Tool calls without a subject scene now produce an execution view: the request, selected provider, and observed result appear as visual playback steps. Planned or unavailable operations are labeled as such; they are never presented as completed work. For example, arithmetic and unit conversions show their numeric result, while a code execution placeholder shows that it did not run.

For explanations with relationships, Bikting compiles the relationship triples and executable renderer properties into a **visual behavior prompt** (shown in the engine trace). The relationship engine builds ordered `highlight`, `flow`, and `pulse` instructions directly in the restricted `bikting-visual-v1` format, and the diagram tool executes them. This requires no second Gemini call. The prompt is a contract for future visualization adapters, not a request sent to Gemini in the current runtime. Specialized renderers still require their own adapters, assets, and verification.

## Pipeline

`src/main.js` sends browser requests to `src/runtime/BiktingRuntime.js`, the production composition root. The runtime owns semantic interpretation, relationship processing, capability-driven planning, execution, and normalized results; the browser only presents its workspace projection.

```text
input → interpretation → plan → module registry/router → execution
      → structured result → SVG workspace + synchronized narration
```

The **Engine Trace** in the workspace records the canonical runtime input, semantic result, plan, selected providers, execution result, provenance, and delivered outputs.

## Extension points

- `src/input`: add voice or image/camera adapters that produce a normalized request.
- `src/runtime`: compose interpretation, registries, orchestration, and a workspace projection; inject future AI, knowledge, or external-provider adapters here.
- `src/interpretation`: translate requests into an intent, domain, concepts, and goal.
- `src/planning`: turn an interpretation into an execution plan.
- `src/modules/registry.js`: register modules implementing `id`, `canHandle(interpretation)`, and `execute({ interpretation, plan })`.
- `src/routing`: choose an appropriate domain module.
- `src/workspace`: render domain visual descriptions and advance workspace state.
- `src/output`: present structured results and narration.

The science motor module emits a causal relationship graph and narration segments that reference visual states. The renderer consumes those instructions; it does not ask an image model to invent a diagram. The general module shows the fallback route and preserves the same result shape. A model, APIs, calculation tools, and workspace integrations can be introduced behind these boundaries as separate execution tools/modules.

## Phase 2 orchestration core

`src/bikting/core` adds a capability-driven planning and execution API. `BiktingOrchestrator` accepts a semantic interpretation adapter, builds an ordered plan using semantic fields and registered capability metadata, selects matching tools/models, normalizes adapter results, and returns a readable `traceText`. `BiktingRuntime` now composes this API into the browser path. Missing capabilities are reported as `unavailable`; placeholder work remains `planned` and causes an overall `partial` result rather than being reported as completed.

Tool/model capability declarations include operation, domain, accepted inputs, produced outputs, deterministic/generative mode, visual/computational/explanatory flags, and execution requirements. Placeholder adapters cover math, physics, statistics, visualization, code, and research; mock model adapters cover text, voice, and vision. The mock semantic interpreter includes sample request fixtures, while `planIntent` does not read request text.

Run `npm.cmd test` from Windows PowerShell to execute all tests. Phase 2 tests exercise the seven requested request types, structured semantic planning, operation-name lookup, deterministic provider preference, unavailable capability handling, result provenance, and orchestration tracing.

## Phase 3 local execution

The same tool registry now includes local deterministic tools for arithmetic/equation evaluation and plotting, statistics, unit conversion, structured physics force calculations, numeric ranges, and structured visualization. `ToolExecutor` passes structured inputs and shared execution context to tools, then normalizes results with source provenance. The planner describes dependencies and `DependencyExecutor` runs them in order. No `eval`, shell, filesystem, or arbitrary code execution is available through these tools.

Supported structured operations include arithmetic expressions (`+ - * / % ^` and parentheses), `y = expression` plot data, mean/median/min/max/population variance/standard deviation/correlation, compatible length/time/mass unit conversion, and `F = m * a`. Input interpretation remains a replaceable mock adapter; tool implementations consume only its structured fields. The browser workspace renders the canonical orchestrator result, including structured scenes, narration when available, execution status, errors, confidence, provenance, and trace data.

## Current scope

Text input and the electric motor science module form the working vertical slice. Other domain recognition currently routes to a structured capability placeholder until a module or execution tool for that domain is registered. Voice is output-only in this slice; voice input and external AI/API adapters remain extension points.
# Intent checkpoint and execution evidence

The workspace shows a preliminary, editable intent checkpoint before `/api/run`.
Change the request or sketch and submit again if the preview is inaccurate; confirmation
only applies to the exact text reviewed. `/api/intent` uses the local lightweight
interpreter so previewing does not spend a Gemini generation call. The final run
may use Gemini when a generated website or interpretation needs it.

Each tool call checks its registered capability and required inputs, then records
observable verification evidence where a domain-specific checker exists. A completed
tool without such a checker is labeled **unverified**, not independently confirmed.
Publishing/deploying and other side-effect capabilities require explicit approval;
account integration and a real deployment provider are not supplied by this gate.
The usage summary records observed Gemini calls, reported token usage when available,
cache hits, and deterministic tool calls. It does not claim an exact dollar cost.

### Knowledge feed

The request composer offers **Gemini knowledge** and **Gemini + web sources**. General-topic requests use Gemini to propose structured concepts and relationships. Web mode first calls Gemini with Google Search grounding, then extracts structured relationships from the research notes. It uses the existing server `GEMINI_API_KEY` and `GEMINI_MODEL`; no separate search key is required. Search depends on model/account support and can incur additional API usage. Deterministic calculations and website builds keep their existing routes.

The workspace shows provider-returned source URLs and evidence excerpts separately from proposed relationships. These relationships are not independently fact-checked. If Google returns no sources, the result is labeled model-generated. Identical interpretation requests share a bounded in-memory cache for five minutes; entries expire and server restarts clear them. Saved project results retain their historical evidence in this browser, not a shared knowledge database. Source links and search suggestions are displayed with the result. Retrieved text is treated as untrusted data.

This adds knowledge ingestion and provenance; it does not yet turn arbitrary concepts into realistic illustrated puzzle pieces. Existing relationship diagrams remain the renderer.
