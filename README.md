# Bikting Engine

A browser prototype of Bikting as a modular interaction and orchestration system. The current browser path previews canonical intent interpretation and planning. It does not execute the plan.

## Run locally

Requires Node.js 20 or newer. From this directory:

```powershell
npm ci
npm start
```

Open <http://127.0.0.1:8000>. Without a model key, the deterministic preview recognizes “Build for me my personal website”; other requests return an explicit refusal. To enable varied requests, set `GEMINI_API_KEY` in the server's environment before `npm start`. Optionally set `GEMINI_MODEL` (default `gemini-2.5-flash`). The key stays server-side; model API usage may incur costs. No account connection or tool execution is performed by the browser preview.

The Gemini adapter produces proposals through `IntelligencePipeline`. Bikting validates capability references and the proposed plan. Factual teaching without configured knowledge sources reports missing knowledge and does not propose teaching steps. Run `npm run typecheck`, `npm test`, and `npm run test:architecture` to check the implementation. This model path is tested with simulated HTTP responses; a live API call requires your own server-side key.

The browser trace also inspects each planned step against the canonical provider registry. It identifies unavailable providers, mock adapters, account requirements, and requested permissions. This is read-only: an available candidate is not selected, authorized, or executed. The website example currently finds a simulated text provider and an unavailable code placeholder.

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
