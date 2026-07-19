# @adaptivemcp/memory

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
