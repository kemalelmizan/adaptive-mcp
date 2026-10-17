# @adaptivemcp/routing

## 0.4.2

### Patch Changes

- Updated dependencies [301af23]
  - @adaptivemcp/spec@0.6.0
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

### Patch Changes

- Updated dependencies [175358c]
- Updated dependencies [8503992]
- Updated dependencies [46edecd]
- Updated dependencies [d28b0fb]
  - @adaptivemcp/spec@0.4.0
  - @adaptivemcp/memory@0.4.0
  - @adaptivemcp/graph-analysis@0.2.1

## 0.3.0

### Minor Changes

- 90e5e71: Phase 10 advanced graph intelligence:

  - `@adaptivemcp/graph-analysis`: `getCausalCascade` (ancestor-based root-cause vs. symptom ordering), `getWorkflowForecast` (historical-baseline duration/cost/failure-probability projection for an in-progress session), and `detectAntiPatterns` (`sequential_bottleneck` and `diamond_dependency` detectors). Also fixes a bug in `detectCommonPatterns` that always attributed duration/success data to the first session in a workflow regardless of which pattern was being counted.
  - `@adaptivemcp/memory`: new `MemoryStore.getWorkflowIds()`, and `Store.getWorkflowIds?()` on the shared interface.
  - `@adaptivemcp/evaluation`: `Evaluator.evaluateAllWorkflows()` was a stub that always returned `[]` — it now enumerates workflows and their sessions, evaluates each, and persists a cross-session `workflow_common_pattern` insight via `GraphAnalyzer.getWorkflowStats`.
  - `@adaptivemcp/routing`: new `Router.routeByPosition(sessionId, analyzer)`, a pure (non-persisting) method that recommends the lowest-latency model for critical-path nodes and the cheapest for leaves in a specific session. Adds `@adaptivemcp/graph-analysis` as a dependency.

### Patch Changes

- Updated dependencies [90e5e71]
- Updated dependencies [9df0b31]
- Updated dependencies [381a6a5]
  - @adaptivemcp/graph-analysis@0.2.0
  - @adaptivemcp/memory@0.3.0
  - @adaptivemcp/spec@0.3.0

## 0.2.2

### Patch Changes

- 00b51e6: Fix the MCP resource URI and make the adaptation loop honest.

  - **spec**: add `TOOLS_METADATA_RESOURCE_URI` (`dev.adaptivemcp://tools-metadata`), a valid URL form of the logical `TOOLS_METADATA_EXTENSION` identifier, for resource registration and reads.
  - **extension**: `ExtensionController.resourceUri()` now returns the valid URI so clients can actually `readResource` it (previously the scheme-less identifier threw `Invalid URL`).
  - **routing**: `Router` recommendation rationale now reflects the real heuristic — "Cheapest model for fast tool" vs "Lowest-latency model for slow tool… trades cost for speed" — instead of always claiming "cheapest".
  - **runtime**: `AdaptiveRuntime.observeCompleted` now runs only the minimal `telemetry → evaluate → sync` loop. Routing, orchestration, and approval are explicit passes (`router.routeAll()` / `orchestrator.planAll()`) the caller invokes once enough signal has accumulated. This is a behavioral change to the public method, so it is a minor bump.

- Updated dependencies [00b51e6]
  - @adaptivemcp/spec@0.2.1
  - @adaptivemcp/memory@0.2.5

## 0.2.1

### Patch Changes

- 67875dd: docs: mark routing/orchestration/approval/thin-client as published

  These four packages are already on npm; their READMEs still carried the
  stale "private / not yet published" status line. Updated the status and added
  usage examples. No API change.

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

## 0.0.4

### Patch Changes

- 507cfad: update ssot to store
- Updated dependencies [507cfad]
  - @adaptivemcp/memory@0.2.3
  - @adaptivemcp/spec@0.1.3

## 0.0.3

### Patch Changes

- 2b4898f: update license
- Updated dependencies [2b4898f]
  - @adaptivemcp/memory@0.2.2
  - @adaptivemcp/spec@0.1.2

## 0.0.2

### Patch Changes

- Updated dependencies [fcb25d7]
  - @adaptivemcp/spec@0.1.1
  - @adaptivemcp/memory@0.2.1

## 0.0.1

### Patch Changes

- Updated dependencies [f750daf]
  - @adaptivemcp/spec@0.1.0
  - @adaptivemcp/memory@0.2.0
