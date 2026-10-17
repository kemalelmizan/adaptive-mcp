# @adaptivemcp/opencode-plugin

## 0.3.1

### Patch Changes

- Updated dependencies [301af23]
  - @adaptivemcp/memory@0.6.0
  - @adaptivemcp/approval@0.2.6
  - @adaptivemcp/evaluation@0.4.2
  - @adaptivemcp/extension@0.5.2
  - @adaptivemcp/middleware@0.1.4
  - @adaptivemcp/orchestration@0.2.6
  - @adaptivemcp/routing@0.4.2
  - @adaptivemcp/telemetry@0.1.9

## 0.3.0

### Minor Changes

- 70914d8: Attribute MCP tool calls to their server and classify non-zero exits as failures.

  - **`server_name` is now derived** for MCP tools. OpenCode names them
    `<server>_<tool>` but omits the server from the hook payload; the adapter reads
    the host's server list (`ctx.mcp.list()`) and attributes the call, so
    `headroom_headroom_compress` records as server `headroom`, tool
    `headroom_compress`.
  - **A `shell` call whose result exits non-zero is recorded as a failure.**
    OpenCode reports such calls as `status: "completed"`, so the learned failure
    rate previously stayed 0 for the most common failure class. Configurable via
    `treatNonZeroExitAsFailure` (`"non-zero"` default, `"gte2"` to treat `exit: 1`
    as a negative result, `"off"` to trust the host).
  - **`dbPath` now defaults to `$XDG_DATA_HOME/adaptivemcp/adaptive.db`** (with
    `tools-metadata.yaml` beside it), so learned metadata persists out of the box;
    `":memory:"` is still available for an ephemeral store.

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

- Updated dependencies [580d8c2]
- Updated dependencies [06c094a]
- Updated dependencies [e897d0e]
  - @adaptivemcp/approval@0.2.5
  - @adaptivemcp/evaluation@0.4.1
  - @adaptivemcp/extension@0.5.1
  - @adaptivemcp/memory@0.5.0
  - @adaptivemcp/middleware@0.1.3
  - @adaptivemcp/orchestration@0.2.5
  - @adaptivemcp/routing@0.4.1
  - @adaptivemcp/telemetry@0.1.8

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
