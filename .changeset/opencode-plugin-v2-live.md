---
"@adaptivemcp/opencode-plugin": minor
---

Add OpenCode V2 support alongside V1: the default export is now a dual-shape
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
