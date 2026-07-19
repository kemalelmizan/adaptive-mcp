---
"@adaptivemcp/spec": minor
"@adaptivemcp/memory": patch
"@adaptivemcp/telemetry": patch
"@adaptivemcp/evaluation": patch
"@adaptivemcp/extension": patch
"@adaptivemcp/routing": minor
"@adaptivemcp/orchestration": minor
"@adaptivemcp/approval": minor
"@adaptivemcp/thin-client": minor
"@adaptivemcp/runtime": minor
---

Decouple packages from the concrete SQLite store and ship a batteries-included runtime.

- Add a `Store` interface to `@adaptivemcp/spec`; `MemoryStore` now implements it.
  All middleware packages depend on the interface, so the persistence backend is
  swappable without touching the learning loop.
- Extract `AdaptiveRuntime` out of `examples` into a new `@adaptivemcp/runtime`
  package (transport-agnostic; accepts any `Store`).
- Promote `routing`, `orchestration`, `approval`, and `thin-client` from private
  stubs to published `0.1.0` packages.
- Unify Node version guidance to "Node 22+ (Node 26 recommended)".
- Add a release dry-run CI gate (`.github/workflows/ci.yml`).
