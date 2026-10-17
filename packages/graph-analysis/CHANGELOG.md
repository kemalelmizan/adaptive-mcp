# @adaptivemcp/graph-analysis

## 0.2.3

### Patch Changes

- Updated dependencies [301af23]
  - @adaptivemcp/spec@0.6.0
  - @adaptivemcp/memory@0.6.0

## 0.2.2

### Patch Changes

- 580d8c2: Internal dependencies now use caret ranges (`workspace:^`) instead of exact pins.

  pnpm rewrote `workspace:*` to an exact version on publish, so a consumer mixing
  `@adaptivemcp/*` packages from different releases could end up with two copies of
  the same package (duplicate state, `instanceof` mismatches, no dedupe). The
  ranges are now compatible (`^x.y.z`), so a resolver picks one copy.

- Updated dependencies [580d8c2]
- Updated dependencies [e897d0e]
  - @adaptivemcp/memory@0.5.0
  - @adaptivemcp/spec@0.5.0

## 0.2.1

### Patch Changes

- Updated dependencies [175358c]
- Updated dependencies [8503992]
- Updated dependencies [46edecd]
- Updated dependencies [d28b0fb]
  - @adaptivemcp/spec@0.4.0
  - @adaptivemcp/memory@0.4.0

## 0.2.0

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

- Updated dependencies [90e5e71]
- Updated dependencies [9df0b31]
- Updated dependencies [381a6a5]
  - @adaptivemcp/memory@0.3.0
  - @adaptivemcp/spec@0.3.0
