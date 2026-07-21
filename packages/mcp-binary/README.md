# @adaptivemcp/mcp-binary

The **only sanctioned shell-out layer** in Adaptive MCP (see `docs/doubts.md` §12b / D10).

It wraps a CLI binary into an MCP stdio server, mapping the binary's CLI onto
MCP tools. Binaries like **rtk** (which has no native MCP server) become
chainable MCP servers this way, then attach to `@adaptivemcp/middleware` like
any other integration — instead of living at the host layer or shelling out
inside core.

```ts
import { createRtkWrapper } from "@adaptivemcp/mcp-binary";

const rtk = createRtkWrapper(); // resolves the user's existing rtk install
if (rtk.available) {
  await rtk.start(); // stdio MCP server exposing `rtk_exec`
}
```

## What "MCP chaining" means here

Adaptive MCP does **not** chain binaries. It chains **MCP servers**.

- Each MCP server (yours, headroom's, rtk's wrapper) is a first-class node in a
  `MiddlewareChain`.
- A middleware runs `beforeCall` / `afterCall` around a tool invocation. The
  `afterCall` of one middleware sees the output produced by the previous one.
- The binary wrapper is just *one* node: it turns a CLI subprocess into an MCP
  tool so it can participate in the chain. The chain itself is protocol-level,
  not process-level.

So when you add rtk to the chain, you are not injecting rtk into every other
tool. You are adding a middleware that, for the tools you route through it, runs
a command via rtk and compresses the result. Other MCP tools are untouched
unless you explicitly route them through the rtk middleware.

## When / how rtk and headroom run

| | headroom | rtk (via this wrapper) |
| --- | --- | --- |
| Native MCP server? | Yes | No — wrapped here |
| Runs as | MCP server in the chain | CLI subprocess spawned by the wrapper |
| Trigger | `afterCall` compresses a tool's string output | `rtk_exec` tool runs a command through `rtk gain` |
| Effect on other tools | Only tools routed through the headroom middleware | Only tools routed through the rtk middleware |
| Telemetry | `headroom` view in `tools-metadata.yaml` | `rtk_exec` calls recorded like any MCP call |

**headroom** is a normal MCP server. Its `HeadroomMiddleware.afterCall` runs
after a tool returns and compresses the string output (D9: passthrough on
failure). It never spawns a process.

**rtk** has no MCP server, so `createRtkWrapper()` wraps the `rtk` CLI into one.
The wrapper exposes a single `rtk_exec` tool. When a tool in the chain calls
`rtk_exec`, the wrapper spawns `rtk gain <command>`, captures stdout, and
returns it. That is the *only* place in Adaptive MCP that spawns a process.

## Layering: this wrapper is NOT the rtk hook

rtk's own value comes from its **PreToolUse hook** (installed by `rtk init -g`),
which rewrites an agent's Bash calls (`git status` → `rtk git status`) *before*
they execute. That hook operates at the **agent's shell layer**.

This MCP wrapper is a **different layer**: it runs rtk as a normal CLI
subprocess *inside the Adaptive MCP middleware chain*, compressing the output of
a tool call that already returned.

```
Agent Bash layer:   rtk hook rewrites `git status` → `rtk git status`   (rtk's own feature)
        │
        ▼
MCP tool-output layer:  tool returns → rtk_exec middleware → `rtk gain` → compressed result
```

The two **compose** rather than conflict: the hook compresses what the agent
sends to the shell; this wrapper compresses what a tool's MCP result carries
back. Adaptive MCP does not install, enable, or disable the rtk hook — it only
reuses the rtk binary if it is already present.

## Graceful coexistence when rtk is already installed

If you already use rtk, Adaptive MCP is **not a nuisance** to your other MCPs:

1. **We reuse your install.** `resolveRtkCommand()` looks up your existing `rtk`
   on `PATH` (or an explicit `command` path). We never download or install a
   second copy, and we never touch your shell config or hook.
2. **We verify it's the right package.** A name collision exists: the Rust
   *Type Kit* crate on crates.io is also called `rtk`. `resolveRtkCommand()`
   probes `rtk --version` and only accepts a binary that prints `rtk <semver>`
   (rtk-ai). If the `rtk` on `PATH` is the wrong package, the wrapper reports
   `wrong-package` and degrades gracefully instead of silently misbehaving.
3. **We degrade, not crash.** If rtk is missing (or the wrong package), the
   wrapper still constructs and registers its tools, but each `rtk_exec` call
   returns a clear setup message (`isError: true`) instead of spawning a missing
   binary. Check `server.available` to know the state up front.
4. **No double-compression surprise.** Because the hook and the wrapper are on
   different layers, routing a tool through `rtk_exec` does not "double up" with
   the hook — the hook affects what the agent runs in the shell; the wrapper
   affects what a tool's MCP result carries back. They are independent knobs.

```ts
import { createRtkWrapper, resolveRtkCommand } from "@adaptivemcp/mcp-binary";

const resolution = resolveRtkCommand(); // { status: "found" | "missing" | "wrong-package" }
const rtk = createRtkWrapper();        // uses the resolved command automatically

if (!rtk.available) {
  // resolution.detail explains why (missing, or wrong `rtk` package on PATH)
  console.warn(resolution.detail);
}
```

## Telemetry integration

Every MCP call — including `rtk_exec` and headroom-compressed results — flows
through the same pipeline as any other tool:

```
tool call → TelemetryRecorder → MemoryStore (SQLite)
          → Evaluator (insights) → ExtensionController
          → tools-metadata.yaml (dev.adaptivemcp/tools-metadata)
```

`AdaptiveRuntime.observeCompleted(output)` accepts the (possibly compressed)
`output` and folds it into `ToolStats`. `MiddlewareChain.contributeView()`
surfaces per-middleware state under the `middleware:` map in
`tools-metadata.yaml` — e.g. `middleware: { headroom: { hash, savingsPercent } }`.
rtk's *own* opt-in telemetry (GDPR-gated, off by default) is separate and
untouched; Adaptive MCP only records the MCP-level calls it makes.

## API

- `createRtkWrapper(options?: RtkWrapperOptions): BinaryMcpServer` — wraps the
  rtk CLI. `options.command` overrides discovery; `options.timeoutMs` bounds
  each spawn; `options.version` sets the advertised server version.
- `resolveRtkCommand(command?: string): RtkResolution` — locates and verifies a
  usable rtk-ai binary. Returns `{ status, command?, detail? }`.
- `BinaryMcpServer` — generic CLI→MCP wrapper. `available` getter, `name` /
  `version` getters, `toolNames()`, `start()`, `close()`.
- `RTK_TOOLS` — the reference `BinaryToolSpec[]` (`rtk_exec` → `rtk gain`).

> **Secure by default.** Discovery is read-only: it probes `rtk --version` and
> never writes to the filesystem, mutates `PATH`, or installs software. If you
> need rtk, install it yourself from <https://rtk-ai.app> (Homebrew, the official
> checksum-hardened installer, or `cargo install`).
