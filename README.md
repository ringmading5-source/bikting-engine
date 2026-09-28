# Bikting Engine

A browser prototype of Bikting as a modular interaction and orchestration system. The current browser path previews canonical intent interpretation and planning. It does not execute the plan.

## Run locally

Requires Node.js 20 or newer. From this directory:

```powershell
npm ci
npm start
```

Open <http://127.0.0.1:8000>. The deterministic website preview recognizes “Build for me my personal website”. Arithmetic and simple learning requests have separate local and public-search routes. Other requests return an explicit refusal. No model key is required or used in the running browser application.

The experimental Gemini adapter remains in the codebase as an inactive module. The running browser application does not register or invoke it. Run `npm run typecheck`, `npm test`, and `npm run test:architecture` to check the implementation.

## Public knowledge lookup

Enter `Teach me cells in biology` or `Explain photosynthesis`. Bikting extracts the topic with a small deterministic rule and queries Wikipedia's public MediaWiki search API through `/api/knowledge`. It displays up to five source links and plain-text search snippets; it does not assemble a lesson or claim the snippets have been checked. The endpoint has a fixed public host, a topic limit, a response limit, and a timeout. If the source is unreachable, it reports the failure. A later knowledge module can evaluate sources and represent their relationships before generating a teaching sequence.

The browser trace also inspects each planned step against the canonical provider registry. It identifies unavailable providers, mock adapters, account requirements, and requested permissions. This inspection itself is read-only.

## Coding example

Enter `Build for me my personal website`, inspect the `code.scaffold` plan, then click **Generate website files**. Bikting recomputes and checks the plan ID on the server, selects a local template provider through the canonical execution guard, and returns three source files: `index.html`, `styles.css`, and `script.js`. The browser shows their source and offers separate downloads. The files form a basic personal website starter with placeholder content to edit. No shell command, model-generated program, filesystem write, or deployment is performed. Arbitrary coding requests still need a real coding provider and a separate execution policy.

## Built-in toolbox

`src/runtime/bikting-owned-tools.ts` is the composition point for installed first-party tools. It registers executable implementations and capability metadata together. The current Bikting-owned tools are `math.calculate` and `code.scaffold`; both run locally without external accounts. Other legacy entries may be placeholders or mocks and are not counted as owned executable tools. Wikipedia is an external knowledge source accessed through Bikting's read-only search adapter, not knowledge that Bikting owns.

## General request routing

`src/runtime/intent-router.ts` registers small intent rules. The browser asks `/api/route` for an intent and capability instead of parsing each command in the UI. The same calculation capability handles “Calculate …” and “Compute …”; the website starter handles “Build for me …” and “Create …”; the learning lookup handles “Teach me …” and “What is …”. A new rule can be registered without modifying the browser dispatch. This is a bounded no-model router: requests outside the registered patterns remain unresolved. Broad semantic understanding and new execution domains require additional interpreters, tools, and evidence handling.

## Private pilot preparation

The server accepts `PORT` and `HOST`. Local development defaults to `127.0.0.1:8000`. A non-local `HOST` fails at startup unless `PILOT_MODE=true`, `PILOT_USERNAME` is set, and `PILOT_PASSWORD` has at least 16 characters. Pilot access uses HTTP Basic authentication, so deploy behind HTTPS and share the password with only invited testers. This is a shared pilot password, not per-user accounts. Rotate it in the host settings to revoke access. The server serves only the browser assets, limits each connecting address to 120 requests per minute, and exposes `/healthz` for the host's health check.

`render.yaml` prepares a Render web service with non-secret settings and prompts for the two secret values on first creation. Do not put the password in the repository or a URL. Run `npm run test:pilot` after `npm ci` to check the access gate, static-file protection, and request limit. The 22-scenario agent-style matrix is part of `npm run test:architecture`. Hosting has not been activated by adding this file; the private pilot is ready to deploy only after the branch is reviewed and a hosting account is connected.

## First guarded execution path

Enter `Calculate 125 * 48` in the browser, then click **Run local calculation**. The explicit button sends the numeric expression to `/api/calculate`, which builds a one-step canonical plan, resolves the local `math.calculator` provider, checks authorization and inputs through the execution guard, invokes the safe expression evaluator, and verifies the observed result. This path accepts numeric arithmetic only (up to 200 characters) and uses no model key, network provider, shell, or filesystem action. Teaching requests still preview plans only.

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

### Capability resolution before execution

`CapabilityResolutionLoop` checks a fixed canonical plan against the installed capability registry, provider registry, user access grants, executable adapters, required inputs, and unresolved knowledge requirements. Each check returns concrete next actions and can be repeated after those dependencies change. A supplied catalog of offers can suggest providers for missing capabilities. The loop stops after a configurable number of checks; it never installs a tool, grants access, or invokes a provider. `ready_for_run` supplies a prepared plan, but execution still requires a separate guarded request. Browser previews show the current next actions under **NEXT ACTION**.

The present pilot has two owned executable tools and read-only public search. Catalog offers, external tool installation, account connections, and interactive input collection require additional integrations before this can handle arbitrary tasks.

Provider resolution also compares declared operations and required input/output names and types when a provider supplies `properties`. The owned calculator and website scaffold declare these properties. A provider's display name cannot make an incompatible declaration suitable. Older provider registrations without independent property declarations still use capability IDs for compatibility; migration and behavioral verification are required before this can be trusted for arbitrary third-party tools.

### Live execution pilot

Calculator and website scaffold runs stream actual canonical execution events to the browser. A public knowledge search reports when retrieval starts and finishes; results retain source links and are not presented as a verified lesson. The trace updates as events arrive; verified arithmetic output is plotted on a signed number line. **Enable live voice** opts into browser speech that narrates selected recorded transitions. Browser speech depends on the user's device and browser. Game and animation tools and true live voice input are not yet installed.

Text input and the electric motor science module form the working vertical slice. Other domain recognition currently routes to a structured capability placeholder until a module or execution tool for that domain is registered. Voice is output-only in this slice; voice input and external AI/API adapters remain extension points.
