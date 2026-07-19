# @adaptivemcp/thin-client

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
