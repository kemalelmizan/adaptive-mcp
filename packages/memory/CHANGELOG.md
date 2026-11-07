# @adaptivemcp/memory

## 0.7.0

### Minor Changes

- e1ac0d5: Keep the order a host declared for context edges.

  `ContextEdge.ordinal` and migration 9: `context_edges` gains an `ordinal` column, and
  `contextEdges()` orders by `(from_item, relation, ordinal, to_item)` instead of by the
  target's name.

  Pointer order is meaningful — a document lists what to read first — and without it a host
  following the recorded edges follows them alphabetically. That is how the second-hop
  benchmark caught it: `catalog-constraints` declares the answer first and a distractor
  second, and the adaptive strategy read the distractor, spent its budget, and never reached
  the answer.

  Recording with no ordinal appends (`max + 1` for that document), so a host that records in
  declaration order needs to think about nothing; re-recording the same edge keeps its place
  and replaces its reason. Existing rows get `0` and fall back to the previous ordering.

- b2eeb03: Persist dependency edges between context items.

  `ContextEdge` / `ContextRelation` and optional `Store.recordContextEdge` /
  `contextEdges`: a `context_edges` table (migration 7), idempotent per
  `(from, to, relation)` so a host can re-derive its edges on every startup without
  growing the table, with `requires` and `see-also` kept apart because they mean
  different things to a host deciding what to follow.

  The shape and the record are shared; traversal — how many hops, what to do on a cycle,
  whether to follow at all — stays host policy, the same split as pause/resume. This is
  what the benchmark's hidden-dependency task needs: an answer that is reachable only
  through a pointer.

- 4a87faa: Persist the retention lifecycle of context items.

  `ContextLifecycle` / `ContextLifecycleState` and optional
  `Store.setContextLifecycle` / `contextLifecycle` / `contextLifecycles`: a
  `context_lifecycle` table (migration 8), one row per item, rewritten in place so a
  sweep never grows the table.

  Only two states, `active` and `archived`, because a state the system cannot decide is
  decoration: `evicted` is the absence of a record, and `restore` is a write back to
  `active`. `pinned` outranks `expiresAt` — a sweep may archive anything expired and
  unpinned, but it must not archive a pin. _When_ to sweep is the host's policy, the same
  split as edges and pause/resume.

- 820e510: Record context loads, so a host can learn which context earns its tokens.

  `ContextEvent`/`ContextStat` and optional `Store.recordContext`/`contextStats`: a load
  folds into a metric cell under a reserved `context` scope, dimensioned by
  `contextItem` + `contextKind`. No `tools` row is created — a context item is not a
  tool — and the counters stay bounded like every other rollup, so a long session costs
  one counter update per item, not a row per load.

  This is the telemetry half of ADR-005's P1: without it a host can say what it loaded
  but not what it was worth.

- 46a345d: Per-model statistics, and a router that uses them.

  The store already folded a `{ model }` metric cell per tool (`MetricDimensions.model`,
  with a cardinality cap), but nothing read it: `Router` chose from a static
  cost/latency list, so "use the model that actually works on this tool" had no
  evidence behind it.

  - `spec`: `ModelStats`, and an optional `Store.modelStats(tool, server?)` — optional
    like `metricCells`, so a backend without dimensional rollups falls back cleanly.
  - `memory`: `modelStats()` sums the `{ model }` lifetime cells (ignoring the overall
    cell, the decoding slices that would double-count, the hourly windows, and the
    `other` overflow bucket), and `modelStatsFromCells()` exposes the derivation.
  - `routing`: `routeTool` now prefers the model with the best **observed** record when
    one has `minModelInvocations` (default 5) samples — reliability first, then latency,
    then cost — and only falls back to the static heuristic when no model has enough
    evidence. The rationale cites the sample count and failure rate it decided from.

### Patch Changes

- Updated dependencies [e1ac0d5]
- Updated dependencies [b2eeb03]
- Updated dependencies [4a87faa]
- Updated dependencies [820e510]
- Updated dependencies [46a345d]
  - @adaptivemcp/spec@0.7.0

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

### Patch Changes

- Updated dependencies [301af23]
  - @adaptivemcp/spec@0.6.0

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
