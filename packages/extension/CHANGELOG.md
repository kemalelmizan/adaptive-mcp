# @adaptivemcp/extension

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
