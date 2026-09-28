# @adaptivemcp/extension

## 0.4.0

### Minor Changes

- 9df0b31: Phase 11 MCP ecosystem integration:

  - `@adaptivemcp/spec`: new canonical `ExecutionGraphResource` wire schema and pure `buildExecutionGraph` builder (`execution-graph.ts`), replacing the dead, Map-based (non-JSON-serializable) `ExecutionGraph` type, which had zero consumers.
  - `@adaptivemcp/extension`: `executionGraphResourceUri`/`workflowGraphResourceUri`/`graphInsightsResourceUri`/`executionGraphMermaidResourceUri` now return correctly-formed `dev.adaptivemcp://...` URIs (previously missing the `//`, a latent bug harmless until these were wired into real MCP protocol dispatch). `executionGraphResourceText` gains `cursor`/`pageSize` pagination options; edges are always returned in full regardless of the current node page.
  - `@adaptivemcp/thin-client`: `GraphTrackingMiddleware` now generates a valid W3C `traceparent` per node (deterministically derived from existing `ExecutionNode` UUIDs — `traceId`/`spanId`/`parentSpanId`/`traceparent` on `metadata`), exposed via a new `getTraceParent()` method. This is a data-plane correlation primitive, not literal over-the-wire header propagation — no live MCP transport exists in this codebase to carry HTTP headers on.
  - `@adaptivemcp/runtime`: `AdaptiveRuntimeOptions.enableGraph` plus `startWorkflow`/`startChild`/`completeNode`/`failNode` pass-throughs, bringing this package to parity with the example-local runtime's existing graph-tracking wiring.
  - `examples/`: the execution-graph resource is now a real, working `ResourceTemplate` with pagination and `resources/subscribe`/`notifications/resources/updated`, verified end-to-end with a live stdio client/server run.

- 3d0b586: Phase 12 visualization & UX:

  - `@adaptivemcp/extension`: new `executionGraphDotResourceUri`/`executionGraphDotResourceText` — a GraphViz DOT export alongside the existing Mermaid export, at `dev.adaptivemcp://execution-graph/{sessionId}/dot`. Also removes a dead, unused `nodeMap` variable from `executionGraphMermaidResourceText`.
  - `examples/`: new `debugging-deployment` scenario (`pnpm scenario:debugging-deployment`) demonstrating the Phase 10 graph-inspection tools no other scenario exercises — causal cascade (root causes vs. symptoms across two independent failure chains), anti-pattern detection, and workflow forecasting — plus Mermaid/DOT diagram exports of the failed graph. `AdaptiveRuntime.startWorkflow` (example-local runtime) gained an optional `sessionId` to support this.

- 381a6a5: Phase 9 production hardening for the execution graph:

  - `@adaptivemcp/memory`: WAL journal mode + tuned PRAGMAs for file-backed stores, a versioned migration framework for `execution_nodes`, and `pruneExecutionNodes`/`retention` for TTL-based cleanup.
  - `@adaptivemcp/thin-client`: `GraphTrackingMiddleware` now uses `AsyncLocalStorage` instead of a shared array stack, fixing a concurrency bug where parallel tool calls (e.g. via `Promise.all`) could misattribute parent/child linkage, cost, and duration to the wrong node. `ThinClient.run()` now wraps each call's full lifecycle in `GraphTrackingMiddleware.runInContext` — a breaking change for direct callers of `GraphTrackingMiddleware.beforeCall`/`afterCall`/`onError` outside that wrapper.
  - `@adaptivemcp/graph-analysis`: new `IncrementalGraphAnalyzer`, an opt-in `GraphAnalyzer` subclass that caches session/workflow node reads to avoid re-querying the store on every call for long-running or repeatedly-polled workflows.
  - `@adaptivemcp/extension`: execution graph MCP resource documents now carry real content-hash ETags instead of an empty placeholder, and `executionGraphResourceText`/`workflowGraphResourceText`/`graphInsightsResourceText` accept an `ifNoneMatch` option, returning `{ notModified: true, etag }` instead of the full document when it matches — a minor breaking change to their return type (`string | NotModified` instead of `string`).

### Patch Changes

- 2391b13: Security: bump runtime dependency versions.

  - `@adaptivemcp/extension`: `js-yaml` `^4.1.0` → `^4.3.2` (patched release).
  - `@adaptivemcp/mcp-binary`: `@modelcontextprotocol/sdk` `^1.29.0` → `^1.30.1`.
  - Workspace `overrides` (in `pnpm-workspace.yaml`) pin patched transitives the
    MCP SDK pulls (hono, `@hono/node-server`, express → qs, ajv → fast-uri) plus
    `ip-address`, and the dev-only `js-yaml@3` tree. `pnpm audit --prod` now
    reports 0 runtime advisories.

- Updated dependencies [90e5e71]
- Updated dependencies [9df0b31]
- Updated dependencies [381a6a5]
  - @adaptivemcp/memory@0.3.0
  - @adaptivemcp/spec@0.3.0

## 0.3.1

### Patch Changes

- f602c85: Improve the `report_observation` server handler (SEP-2133 tools-metadata):

  - `ExtensionController.reportObservationTool()` schema now includes an optional
    `client_id` field for per-client aggregation semantics.
  - New `ExtensionController.reportObservation()` handler validates and folds a
    report into the store: `duration_ms`/`cost` must be finite and non-negative
    (else dropped), `timestamp` must be a parseable ISO-8601 date (else substituted
    with receipt time so `stats.last_observed_at` stays meaningful), and folding is
    opt-in via `foldReports` so a stateless server can register the tool as a
    no-op. `client_id` is preserved in event metadata.
  - The example server (`examples/src/server.ts`) now `ensureTool`s before
    recording, stores the client-supplied `timestamp`, and gates folding with the
    `ADAPTIVE_FOLD_REPORTS` env flag (defaults to on).

## 0.3.0

### Minor Changes

- 773ebf5: Add tools-metadata SEP-2133 fixes to the extension package:

  - `ToolsMetadataDocument` now includes an `etag` field (SHA-1 over the meaningful
    content, excluding the volatile `generated_at`) so clients can detect an
    unchanged view without re-parsing.
  - `toDocument(doc, mimeType)` serializes the view as YAML (default) or JSON via
    content negotiation; `controller.resourceText(mimeType)` now accepts a MIME type.
  - `ExtensionController.reportObservationTool()` exposes the spec-legal
    `report_observation` client→server tool definition (the preferred observation
    channel; `notifications/message` is intentionally not used).
  - YAML rendering uses the safe `yaml.JSON_SCHEMA` to avoid deserialization hazards.

## 0.2.5

### Patch Changes

- 00b51e6: Fix the MCP resource URI and make the adaptation loop honest.

  - **spec**: add `TOOLS_METADATA_RESOURCE_URI` (`dev.adaptivemcp://tools-metadata`), a valid URL form of the logical `TOOLS_METADATA_EXTENSION` identifier, for resource registration and reads.
  - **extension**: `ExtensionController.resourceUri()` now returns the valid URI so clients can actually `readResource` it (previously the scheme-less identifier threw `Invalid URL`).
  - **routing**: `Router` recommendation rationale now reflects the real heuristic — "Cheapest model for fast tool" vs "Lowest-latency model for slow tool… trades cost for speed" — instead of always claiming "cheapest".
  - **runtime**: `AdaptiveRuntime.observeCompleted` now runs only the minimal `telemetry → evaluate → sync` loop. Routing, orchestration, and approval are explicit passes (`router.routeAll()` / `orchestrator.planAll()`) the caller invokes once enough signal has accumulated. This is a behavioral change to the public method, so it is a minor bump.

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
