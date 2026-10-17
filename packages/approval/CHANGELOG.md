# @adaptivemcp/approval

## 0.2.6

### Patch Changes

- Updated dependencies [301af23]
  - @adaptivemcp/spec@0.6.0

## 0.2.5

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

- Updated dependencies [e897d0e]
  - @adaptivemcp/spec@0.5.0

## 0.2.4

### Patch Changes

- Updated dependencies [175358c]
- Updated dependencies [8503992]
- Updated dependencies [46edecd]
- Updated dependencies [d28b0fb]
  - @adaptivemcp/spec@0.4.0
  - @adaptivemcp/memory@0.4.0

## 0.2.3

### Patch Changes

- Updated dependencies [90e5e71]
- Updated dependencies [9df0b31]
- Updated dependencies [381a6a5]
  - @adaptivemcp/memory@0.3.0
  - @adaptivemcp/spec@0.3.0

## 0.2.2

### Patch Changes

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
