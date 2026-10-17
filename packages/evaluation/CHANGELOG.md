# @adaptivemcp/evaluation

## 0.4.2

### Patch Changes

- Updated dependencies [301af23]
  - @adaptivemcp/spec@0.6.0
  - @adaptivemcp/memory@0.6.0
  - @adaptivemcp/graph-analysis@0.2.3

## 0.4.1

### Patch Changes

- 580d8c2: Internal dependencies now use caret ranges (`workspace:^`) instead of exact pins.

  pnpm rewrote `workspace:*` to an exact version on publish, so a consumer mixing
  `@adaptivemcp/*` packages from different releases could end up with two copies of
  the same package (duplicate state, `instanceof` mismatches, no dedupe). The
  ranges are now compatible (`^x.y.z`), so a resolver picks one copy.

- 06c094a: Drop dependencies that were declared but never imported.

  `@adaptivemcp/evaluation` declared six internal dependencies
  (approval, extension, orchestration, routing, telemetry, thin-client) that only
  its cross-package conformance _test_ imports, so installing it pulled ten
  transitive `@adaptivemcp/*` packages instead of three. They move to
  `devDependencies`. Five packages declared `@adaptivemcp/memory` but only import it from
  tests (their source takes the `Store` interface from `spec`) — it moves to
  `devDependencies`. `@adaptivemcp/opencode-plugin` drops three and
  `@adaptivemcp/mcp-binary` one. Fewer packages installed, and a declared
  graph that matches the real one.

- Updated dependencies [580d8c2]
- Updated dependencies [e897d0e]
  - @adaptivemcp/graph-analysis@0.2.2
  - @adaptivemcp/memory@0.5.0
  - @adaptivemcp/spec@0.5.0

## 0.4.0

### Minor Changes

- 46edecd: Phase 6g/6h/6j exercised, plus metadata guardrails.

  - **evaluation:** `Evaluator.evaluateCooccurrence()` — session-scoped
    `tool_cooccurrence` insight (most frequent partners + support), run as part of
    `evaluateAllWorkflows()`. New pure `computeMetricDrift()` — recent-vs-lifetime
    drift from metric cells.
  - **memory/spec:** `Store.getSessionIds?()` + `MemoryStore` implementation; metric
    cardinality cap (`metricCardinality.maxModelsPerTool`, default 8) folds new
    models into an `other` bucket.
  - **extension:** `aggregateViews()` also merges metric cells.
  - **thin-client:** `OAuthMiddleware.handleCallback` now validates the CSRF `state`
    (single-use, server-bound, TTL); `afterCall` refreshes on 401 without the bogus
    retry throw. Adds an OAuth test suite.

### Patch Changes

- Updated dependencies [175358c]
- Updated dependencies [5334879]
- Updated dependencies [b3a91fc]
- Updated dependencies [8503992]
- Updated dependencies [771d1ec]
- Updated dependencies [46edecd]
- Updated dependencies [d28b0fb]
  - @adaptivemcp/spec@0.4.0
  - @adaptivemcp/memory@0.4.0
  - @adaptivemcp/routing@0.4.0
  - @adaptivemcp/thin-client@0.4.0
  - @adaptivemcp/extension@0.5.0
  - @adaptivemcp/approval@0.2.4
  - @adaptivemcp/graph-analysis@0.2.1
  - @adaptivemcp/orchestration@0.2.4
  - @adaptivemcp/telemetry@0.1.7

## 0.3.0

### Minor Changes

- 90e5e71: Phase 10 advanced graph intelligence:

  - `@adaptivemcp/graph-analysis`: `getCausalCascade` (ancestor-based root-cause vs. symptom ordering), `getWorkflowForecast` (historical-baseline duration/cost/failure-probability projection for an in-progress session), and `detectAntiPatterns` (`sequential_bottleneck` and `diamond_dependency` detectors). Also fixes a bug in `detectCommonPatterns` that always attributed duration/success data to the first session in a workflow regardless of which pattern was being counted.
  - `@adaptivemcp/memory`: new `MemoryStore.getWorkflowIds()`, and `Store.getWorkflowIds?()` on the shared interface.
  - `@adaptivemcp/evaluation`: `Evaluator.evaluateAllWorkflows()` was a stub that always returned `[]` — it now enumerates workflows and their sessions, evaluates each, and persists a cross-session `workflow_common_pattern` insight via `GraphAnalyzer.getWorkflowStats`.
  - `@adaptivemcp/routing`: new `Router.routeByPosition(sessionId, analyzer)`, a pure (non-persisting) method that recommends the lowest-latency model for critical-path nodes and the cheapest for leaves in a specific session. Adds `@adaptivemcp/graph-analysis` as a dependency.

### Patch Changes

- b82a6e7: Wire `Evaluator.detectRepetition()` into `evaluateWorkflow()` so the
  `repetition_detected` insight is actually emitted. The detection logic existed
  but had no callers (dead code), so the insight never reached the store; it is now
  produced for repeated 2–4 tool subsequences in a session's execution graph and
  attributed to the workflow id (previously the constant string `"workflow"`).
- Updated dependencies [90e5e71]
- Updated dependencies [9df0b31]
- Updated dependencies [3d0b586]
- Updated dependencies [381a6a5]
- Updated dependencies [2391b13]
  - @adaptivemcp/graph-analysis@0.2.0
  - @adaptivemcp/memory@0.3.0
  - @adaptivemcp/routing@0.3.0
  - @adaptivemcp/spec@0.3.0
  - @adaptivemcp/extension@0.4.0
  - @adaptivemcp/thin-client@0.3.0
  - @adaptivemcp/approval@0.2.3
  - @adaptivemcp/orchestration@0.2.3
  - @adaptivemcp/telemetry@0.1.6

## 0.2.5

### Patch Changes

- Updated dependencies [00b51e6]
  - @adaptivemcp/spec@0.2.1
  - @adaptivemcp/memory@0.2.5

## 0.2.4

### Patch Changes

- 72b57ab: Decouple packages from the concrete SQLite store and ship a batteries-included runtime.

  - Add a `Store` interface to `@adaptivemcp/spec`; `MemoryStore` now implements it.
    All middleware packages depend on the interface, so the persistence backend is
    swappable without touching the learning loop.
  - Extract `AdaptiveRuntime` out of `examples` into a new `@adaptivemcp/runtime`
    package (transport-agnostic; accepts any `Store`).
  - Promote `routing`, `orchestration`, `approval`, and `thin-client` from private
    stubs to published `0.1.0` packages.
  - Unify Node version guidance to "Node 22+ (Node 26 recommended)".
  - Add a release dry-run CI gate (`.github/workflows/ci.yml`).

- Updated dependencies [72b57ab]
  - @adaptivemcp/spec@0.2.0
  - @adaptivemcp/memory@0.2.4

## 0.2.3

### Patch Changes

- 507cfad: update ssot to store
- Updated dependencies [507cfad]
  - @adaptivemcp/memory@0.2.3
  - @adaptivemcp/spec@0.1.3

## 0.2.2

### Patch Changes

- 2b4898f: update license
- Updated dependencies [2b4898f]
  - @adaptivemcp/memory@0.2.2
  - @adaptivemcp/spec@0.1.2

## 0.2.1

### Patch Changes

- fcb25d7: Add per-package README files and include them in the published npm tarballs
  (previously the `files` allowlist shipped only `dist`, so package pages on npm
  showed "This package does not have a README"). Each published package now ships
  usage examples, API tables, and its relationship to the MCP extension surface.
- Updated dependencies [fcb25d7]
  - @adaptivemcp/spec@0.1.1
  - @adaptivemcp/memory@0.2.1

## 0.2.0

### Minor Changes

- f750daf: Initial adaptive implementation: spec foundation (extension identifiers, event
  schemas, shared types), SQLite-backed memory store (SSOT), telemetry
  (recorder + memory-backed store + queries), evaluation (insight generation from
  observed stats), and the extension controller that derives the
  `tools-metadata.yaml` view from the SQLite SSOT.

### Patch Changes

- Updated dependencies [f750daf]
  - @adaptivemcp/spec@0.1.0
  - @adaptivemcp/memory@0.2.0
