# @adaptivemcp/runtime

## 0.4.2

### Patch Changes

- Updated dependencies [301af23]
  - @adaptivemcp/spec@0.6.0
  - @adaptivemcp/memory@0.6.0
  - @adaptivemcp/approval@0.2.6
  - @adaptivemcp/evaluation@0.4.2
  - @adaptivemcp/extension@0.5.2
  - @adaptivemcp/middleware@0.1.4
  - @adaptivemcp/orchestration@0.2.6
  - @adaptivemcp/routing@0.4.2
  - @adaptivemcp/telemetry@0.1.9

## 0.4.1

### Patch Changes

- 580d8c2: Internal dependencies now use caret ranges (`workspace:^`) instead of exact pins.

  pnpm rewrote `workspace:*` to an exact version on publish, so a consumer mixing
  `@adaptivemcp/*` packages from different releases could end up with two copies of
  the same package (duplicate state, `instanceof` mismatches, no dedupe). The
  ranges are now compatible (`^x.y.z`), so a resolver picks one copy.

- 126bdbd: Close only a store the runtime created.

  `AdaptiveRuntime.close()` called `memory.close()` unconditionally, so a runtime built
  on an **injected** `store` closed the caller's store — the documented "swap in a
  file-backed or remote store" path, and exactly the case where sharing happens (a
  parent runtime and its child sessions over one store). Nothing threw at the close;
  the failure surfaced later, in the _other_ runtime, as `database is not open`
  (ERR_INVALID_STATE).

  An injected store now belongs to the caller, who closes it. The self-created path
  is unchanged, so no leak is introduced.

- Updated dependencies [580d8c2]
- Updated dependencies [06c094a]
- Updated dependencies [e897d0e]
  - @adaptivemcp/approval@0.2.5
  - @adaptivemcp/evaluation@0.4.1
  - @adaptivemcp/extension@0.5.1
  - @adaptivemcp/memory@0.5.0
  - @adaptivemcp/middleware@0.1.3
  - @adaptivemcp/orchestration@0.2.5
  - @adaptivemcp/routing@0.4.1
  - @adaptivemcp/telemetry@0.1.8
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

- 64214b8: `AdaptiveRuntimeOptions` gains `routerModels`, `routerBudget`, and
  `routerMinInvocations`, forwarded to the internal `Router`. Hosts that own a
  model catalog can now pass their selectable model ids so `model` recommendations
  reference models they can actually run (previously the Router's two-model preset
  was always used).

### Patch Changes

- Updated dependencies [175358c]
- Updated dependencies [8503992]
- Updated dependencies [46edecd]
- Updated dependencies [d28b0fb]
  - @adaptivemcp/spec@0.4.0
  - @adaptivemcp/memory@0.4.0
  - @adaptivemcp/routing@0.4.0
  - @adaptivemcp/extension@0.5.0
  - @adaptivemcp/evaluation@0.4.0
  - @adaptivemcp/approval@0.2.4
  - @adaptivemcp/middleware@0.1.2
  - @adaptivemcp/orchestration@0.2.4
  - @adaptivemcp/telemetry@0.1.7

## 0.3.0

### Minor Changes

- 9df0b31: Phase 11 MCP ecosystem integration:

  - `@adaptivemcp/spec`: new canonical `ExecutionGraphResource` wire schema and pure `buildExecutionGraph` builder (`execution-graph.ts`), replacing the dead, Map-based (non-JSON-serializable) `ExecutionGraph` type, which had zero consumers.
  - `@adaptivemcp/extension`: `executionGraphResourceUri`/`workflowGraphResourceUri`/`graphInsightsResourceUri`/`executionGraphMermaidResourceUri` now return correctly-formed `dev.adaptivemcp://...` URIs (previously missing the `//`, a latent bug harmless until these were wired into real MCP protocol dispatch). `executionGraphResourceText` gains `cursor`/`pageSize` pagination options; edges are always returned in full regardless of the current node page.
  - `@adaptivemcp/thin-client`: `GraphTrackingMiddleware` now generates a valid W3C `traceparent` per node (deterministically derived from existing `ExecutionNode` UUIDs — `traceId`/`spanId`/`parentSpanId`/`traceparent` on `metadata`), exposed via a new `getTraceParent()` method. This is a data-plane correlation primitive, not literal over-the-wire header propagation — no live MCP transport exists in this codebase to carry HTTP headers on.
  - `@adaptivemcp/runtime`: `AdaptiveRuntimeOptions.enableGraph` plus `startWorkflow`/`startChild`/`completeNode`/`failNode` pass-throughs, bringing this package to parity with the example-local runtime's existing graph-tracking wiring.
  - `examples/`: the execution-graph resource is now a real, working `ResourceTemplate` with pagination and `resources/subscribe`/`notifications/resources/updated`, verified end-to-end with a live stdio client/server run.

### Patch Changes

- Updated dependencies [b82a6e7]
- Updated dependencies [90e5e71]
- Updated dependencies [9df0b31]
- Updated dependencies [3d0b586]
- Updated dependencies [381a6a5]
- Updated dependencies [2391b13]
  - @adaptivemcp/evaluation@0.3.0
  - @adaptivemcp/memory@0.3.0
  - @adaptivemcp/routing@0.3.0
  - @adaptivemcp/spec@0.3.0
  - @adaptivemcp/extension@0.4.0
  - @adaptivemcp/approval@0.2.3
  - @adaptivemcp/middleware@0.1.1
  - @adaptivemcp/orchestration@0.2.3
  - @adaptivemcp/telemetry@0.1.6

## 0.2.2

### Patch Changes

- Updated dependencies [f602c85]
  - @adaptivemcp/extension@0.3.1

## 0.2.1

### Patch Changes

- Updated dependencies [773ebf5]
  - @adaptivemcp/extension@0.3.0

## 0.2.0

### Minor Changes

- 00b51e6: Fix the MCP resource URI and make the adaptation loop honest.

  - **spec**: add `TOOLS_METADATA_RESOURCE_URI` (`dev.adaptivemcp://tools-metadata`), a valid URL form of the logical `TOOLS_METADATA_EXTENSION` identifier, for resource registration and reads.
  - **extension**: `ExtensionController.resourceUri()` now returns the valid URI so clients can actually `readResource` it (previously the scheme-less identifier threw `Invalid URL`).
  - **routing**: `Router` recommendation rationale now reflects the real heuristic — "Cheapest model for fast tool" vs "Lowest-latency model for slow tool… trades cost for speed" — instead of always claiming "cheapest".
  - **runtime**: `AdaptiveRuntime.observeCompleted` now runs only the minimal `telemetry → evaluate → sync` loop. Routing, orchestration, and approval are explicit passes (`router.routeAll()` / `orchestrator.planAll()`) the caller invokes once enough signal has accumulated. This is a behavioral change to the public method, so it is a minor bump.

### Patch Changes

- Updated dependencies [00b51e6]
  - @adaptivemcp/spec@0.2.1
  - @adaptivemcp/extension@0.2.5
  - @adaptivemcp/routing@0.2.2
  - @adaptivemcp/approval@0.2.2
  - @adaptivemcp/evaluation@0.2.5
  - @adaptivemcp/memory@0.2.5
  - @adaptivemcp/orchestration@0.2.2
  - @adaptivemcp/telemetry@0.1.5

## 0.1.1

### Patch Changes

- Updated dependencies [67875dd]
  - @adaptivemcp/routing@0.2.1
  - @adaptivemcp/orchestration@0.2.1
  - @adaptivemcp/approval@0.2.1

## 0.1.0

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
  - @adaptivemcp/telemetry@0.1.4
  - @adaptivemcp/evaluation@0.2.4
  - @adaptivemcp/extension@0.2.4
  - @adaptivemcp/routing@0.2.0
  - @adaptivemcp/orchestration@0.2.0
  - @adaptivemcp/approval@0.2.0
