# @adaptivemcp/opencode-plugin

An [OpenCode](https://opencode.ai) plugin that feeds the Adaptive MCP adaptation
loop: tool executions are recorded as telemetry, run through the Adaptive MCP
middleware chain, evaluated for insights, and projected into the derived
`dev.adaptivemcp/tools-metadata` view.

Not yet published to npm — install from source (see below). If you use
[OpenCode](https://opencode.ai), this is the supported way to point a real agent
at the loop.

## Supported host generations

The default export is a **dual-shape definition** `{ id, setup, server }` that
every OpenCode generation can load from the same module:

| Host                    | Reads                                                                                                   | Ignored    |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | ---------- |
| **V2** (OpenCode ≥ 2.0) | `id` + `setup(ctx)` — registers `ctx.tool.hook("execute.before"/"execute.after")` and returns a cleanup | `server()` |
| **V1 ≥ 1.18.29**        | `id` + `server()` — the classic hooks object                                                            | `setup()`  |
| **V1 (older)**          | function default export — use `createAdaptivePlugin(options)`                                           | —          |

Construction is lazy: the store is built inside `setup()`/`server()` from the
host's options, never at module scope, so importing the module has no side
effects.

### What each hook does

- `execute.before` → `MiddlewareChain.runBefore` + session-id tracking (V2
  carries `sessionID` on every tool event, so no `ctx.event` subscription is
  needed).
- `execute.after` (completed) → `TelemetryRecorder.complete` +
  `MiddlewareChain.runAfter({ ok: true })`.
- `execute.after` (`status: "error"`) → `TelemetryRecorder.fail` +
  `runAfter({ ok: false, error })` — the per-tool error path V1 had no hook for.
  A **non-zero exit code** is _not_ a failure: the host reports those calls as
  `status: "completed"`, so shell-command failures are left to learned policy
  (failure rate, approval gates), not attributed here.
- cleanup / `dispose` → final evaluation + view sync, then store close.

`runError` is never invoked: the middleware chain classifies failures through
`runAfter({ ok: false })`, mirroring `@adaptivemcp/thin-client`.

## Install / configure

### OpenCode V2 — config with options (recommended)

```jsonc
// opencode.json
{
  "plugins": [
    {
      "package": "/path/to/packages/opencode-plugin",
      "options": {
        "dbPath": "./adaptive.db",
        "yamlPath": "./tools-metadata.yaml",
        "approvalPolicy": "high_risk",
        "persistDebounceMs": 0,
      },
    },
  ],
}
```

`options` are read by `readHostOptions`, which picks only JSON-safe keys
(`dbPath`, `yamlPath`, `approvalPolicy`, `persistDebounceMs`). Anything else —
notably `middleware`, which is code — must be passed programmatically via
`createOpenCodePlugin({ middleware: [...] })`. Wrong-typed values are dropped
rather than trusted.

> **Local-directory caveat (verified against OpenCode v2.0.26):** for a
> _directory_ target the host probes only a root-level `server.*` or `index.*`
> file — `package.json` `main`/`exports` are consulted only for npm package
> names. Absolute _file_ plugin paths are rejected (`configured plugin path must
be a directory`). So a local config entry points at a small launcher
> directory whose root `index.mjs` re-exports the built package:
>
> ```js
> // launcher/index.mjs
> export { default } from "/path/to/packages/opencode-plugin/dist/index.js";
> ```

Verified live on OpenCode v2.0.26: the launcher loads, both tool hooks fire, and
the `tools` table + `tools-metadata.yaml` are written with per-tool stats.

### OpenCode V1

```ts
import { createAdaptivePlugin } from "@adaptivemcp/opencode-plugin";

export default createAdaptivePlugin({ dbPath: "./adaptive.db" });
```

`createAdaptivePlugin` returns the host-shaped factory (`{ plugin, ...hooks }`)
for V1's function-default-export convention.

## Programmatic construction

```ts
import { createOpenCodePlugin } from "@adaptivemcp/opencode-plugin";

const definition = createOpenCodePlugin({
  dbPath: "./adaptive.db",
  yamlPath: "./tools-metadata.yaml",
  middleware: [/* your Middleware instances */],
});
// definition.setup(ctx)  — V2, returns a cleanup
// definition.server(...) — V1, returns the hooks object
// definition.plugin      — the AdaptiveMcpPlugin, undefined until the host calls in
```

## Known scope limits

- **No execution-graph tracking.** Neither host generation exposes parent/child
  tool linkage through these hooks, so `execution_nodes` stays empty; graph
  analysis runs on hosts that do provide linkage (e.g. `@adaptivemcp/agent`).
- **Session id = last seen `sessionID`.** A single host process is assumed; no
  per-message attribution.
- **Middleware is code.** It cannot travel through JSON config `options`.
- **Non-zero exits are classified, not reported by the host.** OpenCode reports a
  failing `shell` command as `status: "completed"`; the adapter reads the result's
  `exit` code and classifies it via `treatNonZeroExitAsFailure` (`"non-zero"`
  default, `"gte2"` to treat `exit: 1` as a negative result, `"off"` to trust the
  host). Without this the learned failure rate would stay 0.
- **Token / cost usage is unreachable.** The tool hook payload carries no model
  usage, so `avg_output_tokens` and cost stay 0 on OpenCode and the
  context-cost / cost-drift insights cannot fire here.
- **Persistence is on by default.** With no `dbPath`, the store lives at
  `$XDG_DATA_HOME/adaptivemcp/adaptive.db` (default `~/.local/share/...`) and the
  view at `tools-metadata.yaml` beside it; pass `":memory:"` for an ephemeral run.

## Development

```bash
pnpm build                       # tsc
pnpm vitest run packages/opencode-plugin   # tests run from the repo root
```
