# @adaptivemcp/memory

## 0.5.0

### Minor Changes

- e897d0e: Add the **suspension** record — the durable half of pause/resume (ADR-004).

  `Suspension` (`id`, `sessionId`, `kind`, `question`, `responseSchema?`,
  `resumeState?`, `status`, `answer?`, `reason?`, `createdAt`, `resolvedAt?`) joins
  the shared types, with **optional** `Store` methods — the same pattern the graph
  methods use — so a backend that cannot persist a paused run simply omits them:

  - `recordSuspension`, `getSuspension`, `getSuspensions(sessionId, status?)`,
  - `resolveSuspension(id, { status, answer?, reason? })`.

  `@adaptivemcp/memory` implements them in a new `suspensions` table (migration 5).
  Resolving is **idempotent**: an already-resolved record is returned unchanged, so
  a replayed resume cannot overwrite the first answer — the same hazard
  `langgraph` documents, since its resume re-executes the node it resumed into.

  Nothing about graphs, threads or schedulers is implied: the _shape_ is shared so
  every host records a pause the same way, and the **host** (which may suspend, who
  may answer, how a resume is applied) owns the policy.

### Patch Changes

- 580d8c2: Internal dependencies now use caret ranges (`workspace:^`) instead of exact pins.

  pnpm rewrote `workspace:*` to an exact version on publish, so a consumer mixing
  `@adaptivemcp/*` packages from different releases could end up with two copies of
  the same package (duplicate state, `instanceof` mismatches, no dedupe). The
  ranges are now compatible (`^x.y.z`), so a resolver picks one copy.

- Updated dependencies [e897d0e]
  - @adaptivemcp/spec@0.5.0

## 0.4.0

### Minor Changes

- 175358c: Rich, queryable metadata without a raw events table; time-bucketed cells, retry
  accounting, and metrics in the derived view.

  - **spec:** `ToolExecutionEvent` gains optional `decoding`, `usage`, and
    `attempts`; new `MetricDimensions`/`MetricCell`; `Store.metricCells?()`.
  - **memory:** migration 3 adds `metric_cells` — bounded dimension tuples folded
    on `recordExecution` (counters, error codes, a fixed-bucket duration histogram,
    token/cost sums, attempts, EWMA recency, bounded exemplars); migration 4 adds
    `attempts`. The overall cell also gets an hourly window for drift, pruned by
    retention. `metricCells()` reads them.
  - **thin-client:** `ThinClient.run` returns `attempts` (≥1; >1 when retried).
  - **runtime:** `observeCompleted` forwards `decoding`/`usage`/`attempts`.
  - **routing:** `DecodingAnalyzer` (pure, computed-on-read) over events or, via
    `analyzeCells()`, the durable cells.
  - **extension:** the derived view gains a per-tool `metrics` map (window/dimension
    labels → counts, failure rate, latency, tokens, `retry_rate`, EWMA).

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

- 8503992: Load `node:sqlite` via `createRequire` (with a type-only import) instead of a
  bare `import "node:sqlite"`. Most bundlers' builtin lists predate the builtin, so
  consuming `memory` as a dependency (e.g. the first-party agent under Vite/Vitest)
  mis-resolved it as the package `sqlite` and failed. Behaviour is unchanged.
- Updated dependencies [175358c]
- Updated dependencies [46edecd]
- Updated dependencies [d28b0fb]
  - @adaptivemcp/spec@0.4.0

## 0.3.0

### Minor Changes

- 90e5e71: Phase 10 advanced graph intelligence:

  - `@adaptivemcp/graph-analysis`: `getCausalCascade` (ancestor-based root-cause vs. symptom ordering), `getWorkflowForecast` (historical-baseline duration/cost/failure-probability projection for an in-progress session), and `detectAntiPatterns` (`sequential_bottleneck` and `diamond_dependency` detectors). Also fixes a bug in `detectCommonPatterns` that always attributed duration/success data to the first session in a workflow regardless of which pattern was being counted.
  - `@adaptivemcp/memory`: new `MemoryStore.getWorkflowIds()`, and `Store.getWorkflowIds?()` on the shared interface.
  - `@adaptivemcp/evaluation`: `Evaluator.evaluateAllWorkflows()` was a stub that always returned `[]` — it now enumerates workflows and their sessions, evaluates each, and persists a cross-session `workflow_common_pattern` insight via `GraphAnalyzer.getWorkflowStats`.
  - `@adaptivemcp/routing`: new `Router.routeByPosition(sessionId, analyzer)`, a pure (non-persisting) method that recommends the lowest-latency model for critical-path nodes and the cheapest for leaves in a specific session. Adds `@adaptivemcp/graph-analysis` as a dependency.

- 381a6a5: Phase 9 production hardening for the execution graph:

  - `@adaptivemcp/memory`: WAL journal mode + tuned PRAGMAs for file-backed stores, a versioned migration framework for `execution_nodes`, and `pruneExecutionNodes`/`retention` for TTL-based cleanup.
  - `@adaptivemcp/thin-client`: `GraphTrackingMiddleware` now uses `AsyncLocalStorage` instead of a shared array stack, fixing a concurrency bug where parallel tool calls (e.g. via `Promise.all`) could misattribute parent/child linkage, cost, and duration to the wrong node. `ThinClient.run()` now wraps each call's full lifecycle in `GraphTrackingMiddleware.runInContext` — a breaking change for direct callers of `GraphTrackingMiddleware.beforeCall`/`afterCall`/`onError` outside that wrapper.
  - `@adaptivemcp/graph-analysis`: new `IncrementalGraphAnalyzer`, an opt-in `GraphAnalyzer` subclass that caches session/workflow node reads to avoid re-querying the store on every call for long-running or repeatedly-polled workflows.
  - `@adaptivemcp/extension`: execution graph MCP resource documents now carry real content-hash ETags instead of an empty placeholder, and `executionGraphResourceText`/`workflowGraphResourceText`/`graphInsightsResourceText` accept an `ifNoneMatch` option, returning `{ notModified: true, etag }` instead of the full document when it matches — a minor breaking change to their return type (`string | NotModified` instead of `string`).

### Patch Changes

- Updated dependencies [9df0b31]
  - @adaptivemcp/spec@0.3.0

## 0.2.5

### Patch Changes

- Updated dependencies [00b51e6]
  - @adaptivemcp/spec@0.2.1

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

## 0.2.3

### Patch Changes

- 507cfad: update ssot to store
- Updated dependencies [507cfad]
  - @adaptivemcp/spec@0.1.3

## 0.2.2

### Patch Changes

- 2b4898f: update license
- Updated dependencies [2b4898f]
  - @adaptivemcp/spec@0.1.2

## 0.2.1

### Patch Changes

- fcb25d7: Add per-package README files and include them in the published npm tarballs
  (previously the `files` allowlist shipped only `dist`, so package pages on npm
  showed "This package does not have a README"). Each published package now ships
  usage examples, API tables, and its relationship to the MCP extension surface.
- Updated dependencies [fcb25d7]
  - @adaptivemcp/spec@0.1.1

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
