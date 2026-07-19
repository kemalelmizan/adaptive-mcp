# @adaptivemcp/runtime

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
