# @adaptivemcp/runtime

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
