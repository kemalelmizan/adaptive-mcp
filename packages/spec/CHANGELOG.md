# @adaptivemcp/spec

## 0.6.0

### Minor Changes

- 301af23: Add the **task list** and **typed memory steps** — the durable half of two more
  components ADR-004 places in `spec` (the orchestrator's shared task list, and the
  planning pass's steps).

  `spec` gains three records and the optional `Store` methods that persist them,
  following the same pattern as the suspension record:

  - **`Task`** — `id`, `sessionId`, `title`, `description?`, `status`, `assignee?`,
    `dependencies[]`, `parentId?`, `result?`, `notes?`, `createdAt`, `updatedAt?`.
    `TaskStatus` is `agno`'s five states (`pending`, `in_progress`, `completed`,
    `failed`, `blocked`) plus `cancelled`, because a host that can suspend a run also
    needs a word for _given up on_ rather than _failed_.
  - **`ActionStep`** — what was attempted and how it went (`summary`, `toolName?`,
    `error?`, `durationMs?`, `correlationId?`). It is the intent-and-outcome view a
    run replays from, **not** a second copy of telemetry: a host that also records the
    execution graph sets `correlationId` and the bodies stay where they already live.
  - **`PlanStep`** — a plan as ordered intents plus the `reasoning?` that produced it.
    Keeping the plan as a record is what makes a planning interval meaningful.
  - `StepRecord` is their union and `StepKind` its discriminator, so a reader can
    distinguish _intended_ / _planned_ / _done_ in one pass.

  `@adaptivemcp/memory` persists them in a new migration (6) and implements the
  methods:

  - `recordTask`, `getTask`, `getTasks(sessionId, { status?, assignee?, parentId? })`,
    `updateTask(id, patch)` — an upsert plus the transition helper, which stamps
    `updatedAt` and **does not police transitions**: moving status from any state is
    the host's policy, not the store's;
  - `readyTasks(sessionId)` — the dependency-ordering read, and the reason
    dependencies are their own table rather than a JSON column: _pending, with every
    dependency completed, oldest first_ is one SQL question that stays correct as
    statuses move. A dependency that matches no task **blocks** rather than
    unblocking, so a typo or a stale id fails closed;
  - `recordStep`, `getStep`, `getSteps(sessionId, { kind? })` — action and plan steps
    share one table under a `kind` discriminator, so `getSteps` can return a session's
    **whole history in order** (tasks, plans and actions merged, ties broken on id),
    which is what "typed steps, replayable" means in practice.

  Nothing here implies a coordinator, a scheduler or a mode enum: `orchestration`
  still owns _execution composition_, and the planning pass needs the model, so it is
  the host's. The shapes exist so two hosts record the same work the same way.

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

## 0.3.0

### Minor Changes

- 9df0b31: Phase 11 MCP ecosystem integration:

  - `@adaptivemcp/spec`: new canonical `ExecutionGraphResource` wire schema and pure `buildExecutionGraph` builder (`execution-graph.ts`), replacing the dead, Map-based (non-JSON-serializable) `ExecutionGraph` type, which had zero consumers.
  - `@adaptivemcp/extension`: `executionGraphResourceUri`/`workflowGraphResourceUri`/`graphInsightsResourceUri`/`executionGraphMermaidResourceUri` now return correctly-formed `dev.adaptivemcp://...` URIs (previously missing the `//`, a latent bug harmless until these were wired into real MCP protocol dispatch). `executionGraphResourceText` gains `cursor`/`pageSize` pagination options; edges are always returned in full regardless of the current node page.
  - `@adaptivemcp/thin-client`: `GraphTrackingMiddleware` now generates a valid W3C `traceparent` per node (deterministically derived from existing `ExecutionNode` UUIDs — `traceId`/`spanId`/`parentSpanId`/`traceparent` on `metadata`), exposed via a new `getTraceParent()` method. This is a data-plane correlation primitive, not literal over-the-wire header propagation — no live MCP transport exists in this codebase to carry HTTP headers on.
  - `@adaptivemcp/runtime`: `AdaptiveRuntimeOptions.enableGraph` plus `startWorkflow`/`startChild`/`completeNode`/`failNode` pass-throughs, bringing this package to parity with the example-local runtime's existing graph-tracking wiring.
  - `examples/`: the execution-graph resource is now a real, working `ResourceTemplate` with pagination and `resources/subscribe`/`notifications/resources/updated`, verified end-to-end with a live stdio client/server run.

## 0.2.1

### Patch Changes

- 00b51e6: Fix the MCP resource URI and make the adaptation loop honest.

  - **spec**: add `TOOLS_METADATA_RESOURCE_URI` (`dev.adaptivemcp://tools-metadata`), a valid URL form of the logical `TOOLS_METADATA_EXTENSION` identifier, for resource registration and reads.
  - **extension**: `ExtensionController.resourceUri()` now returns the valid URI so clients can actually `readResource` it (previously the scheme-less identifier threw `Invalid URL`).
  - **routing**: `Router` recommendation rationale now reflects the real heuristic — "Cheapest model for fast tool" vs "Lowest-latency model for slow tool… trades cost for speed" — instead of always claiming "cheapest".
  - **runtime**: `AdaptiveRuntime.observeCompleted` now runs only the minimal `telemetry → evaluate → sync` loop. Routing, orchestration, and approval are explicit passes (`router.routeAll()` / `orchestrator.planAll()`) the caller invokes once enough signal has accumulated. This is a behavioral change to the public method, so it is a minor bump.

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

## 0.1.3

### Patch Changes

- 507cfad: update ssot to store

## 0.1.2

### Patch Changes

- 2b4898f: update license

## 0.1.1

### Patch Changes

- fcb25d7: Add per-package README files and include them in the published npm tarballs
  (previously the `files` allowlist shipped only `dist`, so package pages on npm
  showed "This package does not have a README"). Each published package now ships
  usage examples, API tables, and its relationship to the MCP extension surface.

## 0.1.0

### Minor Changes

- f750daf: Initial adaptive implementation: spec foundation (extension identifiers, event
  schemas, shared types), SQLite-backed memory store (SSOT), telemetry
  (recorder + memory-backed store + queries), evaluation (insight generation from
  observed stats), and the extension controller that derives the
  `tools-metadata.yaml` view from the SQLite SSOT.
