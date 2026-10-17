# @adaptivemcp/thin-client

## 0.5.1

### Patch Changes

- Updated dependencies [301af23]
  - @adaptivemcp/spec@0.6.0
  - @adaptivemcp/approval@0.2.6
  - @adaptivemcp/middleware@0.1.4
  - @adaptivemcp/orchestration@0.2.6
  - @adaptivemcp/routing@0.4.2

## 0.5.0

### Minor Changes

- 7b0d76f: Fail closed on an unconfigured approver.

  `requestApproval` defaulted to **approve**, so a host that never wired an
  approver silently ran every tool the gate marked `require_confirmation` — a tool
  a policy had flagged for a human, in a mode where nobody is asked. The default is
  now **deny**: auto-approval is an explicit opt-in (`requestApproval: () => true`).
  The denial is recorded as `"approval denied"` rather than `"approval denied by
user"`, since in this path no user was involved.

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
- Updated dependencies [06c094a]
- Updated dependencies [e897d0e]
  - @adaptivemcp/approval@0.2.5
  - @adaptivemcp/middleware@0.1.3
  - @adaptivemcp/orchestration@0.2.5
  - @adaptivemcp/routing@0.4.1
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

- 5334879: `envelopeClassifier` now also inspects JSON-**string** outputs. Most MCP servers
  serialize an in-band envelope as text content (a plain `dict` return produces no
  `structuredContent`), so the payload arrives as a string — for example a
  FastMCP server returning `{ "status": "error", "error": "POLICY_DENIED" }` as
  text. The parse is guarded (only strings starting with `{`) and can be disabled
  with `parseJsonString: false`.
- b3a91fc: `ToolHandler` now receives a `ToolHandlerCallContext` as its second argument
  (`toolName`, `serverName`, `credentials`). Middleware that resolves auth in
  `beforeCall` (e.g. `OAuthMiddleware`, which writes `PlannedCall.credentials`)
  can now have those credentials reach the transport — previously they were
  written and never read by anything but the middleware itself. Existing
  single-argument handlers remain valid.
- 771d1ec: Add `GraphTrackingMiddleware.runTurn(label, fn)`: runs a batch of top-level tool
  calls under one execution-graph root, so a turn with several calls forms a single
  DAG instead of one disconnected root per call. The root is completed when `fn`
  resolves and failed when it rejects. Existing per-call-root behavior is unchanged
  when `runTurn` is not used.
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

- d28b0fb: Add a **result-classification seam**. Some MCP servers report logical failures
  in-band — a successful transport result whose JSON payload carries an error
  status (e.g. `{ "status": "error", "error": "POLICY_DENIED" }`) — instead of the
  protocol-level `isError` flag. Previously `ThinClient` recorded those as
  successes, corrupting every derived signal.

  - `@adaptivemcp/spec`: new `ToolCallOutcome`, `ToolResultClassification`,
    `ToolResultContext`, and `ToolResultClassifier` types.
  - `@adaptivemcp/thin-client`: `ThinClientOptions.classifyResult` runs on each
    attempt, before the outcome is recorded and before the retry decision (so a
    reclassified failure counts as a failure and can trigger retry). Adds an
    `envelopeClassifier()` helper for the common status/error envelope shape.

### Patch Changes

- Updated dependencies [175358c]
- Updated dependencies [8503992]
- Updated dependencies [46edecd]
- Updated dependencies [d28b0fb]
  - @adaptivemcp/spec@0.4.0
  - @adaptivemcp/memory@0.4.0
  - @adaptivemcp/routing@0.4.0
  - @adaptivemcp/approval@0.2.4
  - @adaptivemcp/middleware@0.1.2
  - @adaptivemcp/orchestration@0.2.4

## 0.3.0

### Minor Changes

- 9df0b31: Phase 11 MCP ecosystem integration:

  - `@adaptivemcp/spec`: new canonical `ExecutionGraphResource` wire schema and pure `buildExecutionGraph` builder (`execution-graph.ts`), replacing the dead, Map-based (non-JSON-serializable) `ExecutionGraph` type, which had zero consumers.
  - `@adaptivemcp/extension`: `executionGraphResourceUri`/`workflowGraphResourceUri`/`graphInsightsResourceUri`/`executionGraphMermaidResourceUri` now return correctly-formed `dev.adaptivemcp://...` URIs (previously missing the `//`, a latent bug harmless until these were wired into real MCP protocol dispatch). `executionGraphResourceText` gains `cursor`/`pageSize` pagination options; edges are always returned in full regardless of the current node page.
  - `@adaptivemcp/thin-client`: `GraphTrackingMiddleware` now generates a valid W3C `traceparent` per node (deterministically derived from existing `ExecutionNode` UUIDs — `traceId`/`spanId`/`parentSpanId`/`traceparent` on `metadata`), exposed via a new `getTraceParent()` method. This is a data-plane correlation primitive, not literal over-the-wire header propagation — no live MCP transport exists in this codebase to carry HTTP headers on.
  - `@adaptivemcp/runtime`: `AdaptiveRuntimeOptions.enableGraph` plus `startWorkflow`/`startChild`/`completeNode`/`failNode` pass-throughs, bringing this package to parity with the example-local runtime's existing graph-tracking wiring.
  - `examples/`: the execution-graph resource is now a real, working `ResourceTemplate` with pagination and `resources/subscribe`/`notifications/resources/updated`, verified end-to-end with a live stdio client/server run.

- 381a6a5: Phase 9 production hardening for the execution graph:

  - `@adaptivemcp/memory`: WAL journal mode + tuned PRAGMAs for file-backed stores, a versioned migration framework for `execution_nodes`, and `pruneExecutionNodes`/`retention` for TTL-based cleanup.
  - `@adaptivemcp/thin-client`: `GraphTrackingMiddleware` now uses `AsyncLocalStorage` instead of a shared array stack, fixing a concurrency bug where parallel tool calls (e.g. via `Promise.all`) could misattribute parent/child linkage, cost, and duration to the wrong node. `ThinClient.run()` now wraps each call's full lifecycle in `GraphTrackingMiddleware.runInContext` — a breaking change for direct callers of `GraphTrackingMiddleware.beforeCall`/`afterCall`/`onError` outside that wrapper.
  - `@adaptivemcp/graph-analysis`: new `IncrementalGraphAnalyzer`, an opt-in `GraphAnalyzer` subclass that caches session/workflow node reads to avoid re-querying the store on every call for long-running or repeatedly-polled workflows.
  - `@adaptivemcp/extension`: execution graph MCP resource documents now carry real content-hash ETags instead of an empty placeholder, and `executionGraphResourceText`/`workflowGraphResourceText`/`graphInsightsResourceText` accept an `ifNoneMatch` option, returning `{ notModified: true, etag }` instead of the full document when it matches — a minor breaking change to their return type (`string | NotModified` instead of `string`).

### Patch Changes

- Updated dependencies [90e5e71]
- Updated dependencies [9df0b31]
- Updated dependencies [381a6a5]
  - @adaptivemcp/memory@0.3.0
  - @adaptivemcp/routing@0.3.0
  - @adaptivemcp/spec@0.3.0
  - @adaptivemcp/approval@0.2.3
  - @adaptivemcp/middleware@0.1.1
  - @adaptivemcp/orchestration@0.2.3

## 0.2.2

### Patch Changes

- Updated dependencies [00b51e6]
  - @adaptivemcp/spec@0.2.1
  - @adaptivemcp/approval@0.2.2
  - @adaptivemcp/memory@0.2.5
  - @adaptivemcp/orchestration@0.2.2

## 0.2.1

### Patch Changes

- 67875dd: docs: mark routing/orchestration/approval/thin-client as published

  These four packages are already on npm; their READMEs still carried the
  stale "private / not yet published" status line. Updated the status and added
  usage examples. No API change.

- Updated dependencies [67875dd]
  - @adaptivemcp/orchestration@0.2.1
  - @adaptivemcp/approval@0.2.1

## 0.2.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [72b57ab]
  - @adaptivemcp/spec@0.2.0
  - @adaptivemcp/memory@0.2.4
  - @adaptivemcp/orchestration@0.2.0
  - @adaptivemcp/approval@0.2.0

## 0.0.4

### Patch Changes

- 507cfad: update ssot to store
- Updated dependencies [507cfad]
  - @adaptivemcp/approval@0.0.4
  - @adaptivemcp/memory@0.2.3
  - @adaptivemcp/orchestration@0.0.4
  - @adaptivemcp/spec@0.1.3

## 0.0.3

### Patch Changes

- 2b4898f: update license
- Updated dependencies [2b4898f]
  - @adaptivemcp/approval@0.0.3
  - @adaptivemcp/memory@0.2.2
  - @adaptivemcp/orchestration@0.0.3
  - @adaptivemcp/spec@0.1.2

## 0.0.2

### Patch Changes

- Updated dependencies [fcb25d7]
  - @adaptivemcp/spec@0.1.1
  - @adaptivemcp/memory@0.2.1
  - @adaptivemcp/approval@0.0.2
  - @adaptivemcp/orchestration@0.0.2

## 0.0.1

### Patch Changes

- Updated dependencies [f750daf]
  - @adaptivemcp/spec@0.1.0
  - @adaptivemcp/memory@0.2.0
  - @adaptivemcp/approval@0.0.1
  - @adaptivemcp/orchestration@0.0.1
