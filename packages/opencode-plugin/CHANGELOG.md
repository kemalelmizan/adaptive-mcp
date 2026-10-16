# @adaptivemcp/opencode-plugin

## 0.2.0

### Minor Changes

- b50b751: Add OpenCode V2 support alongside V1: the default export is now a dual-shape
  `{ id, setup, server }` definition. V2 (OpenCode ≥ 2.0) reads `id` + `setup(ctx)`,
  which registers `ctx.tool.hook("execute.before"/"execute.after")` and returns a
  cleanup; V1 ≥ 1.18.29 keeps reading `id` + `server()`; older V1 keeps
  `createAdaptivePlugin`. The store is constructed lazily inside `setup`/`server`
  from host options (`readHostOptions` picks only JSON-safe keys), `execute.after`
  with `status: "error"` records a tool failure through
  `TelemetryRecorder.fail` + `MiddlewareChain.runAfter({ ok: false })`, and session
  ids come from the tool event's own `sessionID`. A root `index.mjs` shim lets
  OpenCode load the package directly as a local directory plugin target. Verified
  live against OpenCode v2.0.26 (per-tool `tools` rows and `tools-metadata.yaml`
  written from config `plugins` options).

### Patch Changes

- Updated dependencies [175358c]
- Updated dependencies [5334879]
- Updated dependencies [b3a91fc]
- Updated dependencies [8503992]
- Updated dependencies [771d1ec]
- Updated dependencies [46edecd]
- Updated dependencies [d28b0fb]
  - @adaptivemcp/spec@0.4.0
  - @adaptivemcp/memory@0.4.0
  - @adaptivemcp/routing@0.4.0
  - @adaptivemcp/thin-client@0.4.0
  - @adaptivemcp/extension@0.5.0
  - @adaptivemcp/evaluation@0.4.0
  - @adaptivemcp/approval@0.2.4
  - @adaptivemcp/graph-analysis@0.2.1
  - @adaptivemcp/middleware@0.1.2
  - @adaptivemcp/orchestration@0.2.4
  - @adaptivemcp/telemetry@0.1.7

## 0.1.1

### Patch Changes

- Updated dependencies [b82a6e7]
- Updated dependencies [90e5e71]
- Updated dependencies [9df0b31]
- Updated dependencies [3d0b586]
- Updated dependencies [381a6a5]
- Updated dependencies [2391b13]
  - @adaptivemcp/evaluation@0.3.0
  - @adaptivemcp/graph-analysis@0.2.0
  - @adaptivemcp/memory@0.3.0
  - @adaptivemcp/routing@0.3.0
  - @adaptivemcp/spec@0.3.0
  - @adaptivemcp/extension@0.4.0
  - @adaptivemcp/thin-client@0.3.0
  - @adaptivemcp/approval@0.2.3
  - @adaptivemcp/middleware@0.1.1
  - @adaptivemcp/orchestration@0.2.3
  - @adaptivemcp/telemetry@0.1.6
