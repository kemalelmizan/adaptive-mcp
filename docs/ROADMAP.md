# Adaptive MCP: Implementation Plan

This document tracks the phased implementation of Adaptive MCP. It is a living
plan: each phase is validated by runnable examples before the next begins.

## Guiding constraints

- **Node 22+** (Node 26 recommended)
- **pnpm 11+** (pinned via the repo's `packageManager` field).
- **SQLite is the store.** The `tools-metadata.yaml`
  file is a *derived view* of the SQLite store, never edited directly.
- **Adaptive MCP computes and writes the YAML.** MCP clients read the YAML as a
  static, human- and machine-readable projection of learned behavior.
- **MCP extension pattern.** Adaptive behavior lives in middleware packages, not
  in the server. Servers stay stateless and lightweight.

## How to run

```bash
pnpm install
pnpm build                 # build all publishable packages
pnpm test                  # vitest, full suite

# Quick tour of the adaptation loop (prints the derived tools-metadata YAML):
pnpm --filter @adaptivemcp/examples quickstart

# Improvement-over-time scenario (prints YAML after each phase):
pnpm --filter @adaptivemcp/examples scenario

# MCP server + client over stdio:
pnpm --filter @adaptivemcp/examples server
pnpm --filter @adaptivemcp/examples client
```

| Package | Responsibility | Status |
| --- | --- | --- |
| `@adaptivemcp/spec` | Extension identifiers, event schemas, shared types, `Store` interface | ✅ done |
| `@adaptivemcp/memory` | SQLite store (`node:sqlite`), reference `Store` impl | ✅ done |
| `@adaptivemcp/telemetry` | Recorder + memory-backed store + queries | ✅ done |
| `@adaptivemcp/evaluation` | Insight generation from observed stats | ✅ done |
| `@adaptivemcp/extension` | Derives + writes `tools-metadata.yaml` view | ✅ done |
| `@adaptivemcp/routing` | Model selection / budget optimization | ✅ done |
| `@adaptivemcp/orchestration` | Execution composition / retries | ✅ done |
| `@adaptivemcp/approval` | Intent → plan → tool approval gate | ✅ done |
| `@adaptivemcp/thin-client` | Client-side execution loop + middleware hooks | ✅ done |
| `@adaptivemcp/middleware` | `Middleware` plugin interface + `MiddlewareChain` + `Compressor` abstraction | ✅ done |
| `@adaptivemcp/mcp-binary` | Generic CLI-binary → MCP-server wrapper (rtk) | ✅ done |
| `@adaptivemcp/runtime` | Batteries-included `AdaptiveRuntime` wiring all packages | ✅ done |
| `examples` | Runnable server + client + scenarios | ✅ done |

> Note (2026-07-22): `middleware` and `mcp-binary` are implemented, tested, and
> wired into `AdaptiveRuntime`/`ThinClient` (see Phase 5), but are not yet in
> `PUBLISHABLE_PACKAGES` (`scripts/lib/workspace.ts`) — add them there before the
> next release.

## Phase 0: Foundation (complete)

- Monorepo: pnpm workspaces, TypeScript strict, ESLint 9, Prettier, Vitest,
  Changesets.
- `@adaptivemcp/spec`: `ToolRecord`, `ToolStats`, `Insight`, `Recommendation`,
  `Annotation`, event schema, extension namespace `dev.adaptivemcp/` (reversed-domain identifiers).
- `@adaptivemcp/memory`: `MemoryStore` over `node:sqlite` with `tools` table.

## Phase 1: Observation to store to View (complete)

- `@adaptivemcp/telemetry`: `TelemetryRecorder` + `MemoryBackedTelemetryStore`
  that folds events into the store via `memory.recordExecution`.
- `@adaptivemcp/evaluation`: `Evaluator` emits `observed_failure_rate` and
  `avg_duration_ms` insights once a confidence threshold is met.
- `@adaptivemcp/extension`: `ExtensionController` renders the store to
  `tools-metadata.yaml` and exposes it as the `dev.adaptivemcp/tools-metadata`
  MCP resource.

**Validated by:** `examples` scenario (healthy → flaky → fixed) and the
stdio server/client example. The YAML view evolves automatically; the human
`annotation.risk` field stays static.

## Phase 2: Recommendations and routing (complete)

- `@adaptivemcp/evaluation` emits `Recommendation`s (e.g. "add retry",
  "flag high-risk") into the store.
- `@adaptivemcp/routing` consumes stats + insights to suggest model/budget
  choices; surfaces them in the YAML `recommendations` list.
- `@adaptivemcp/orchestration` derives retry policies from observed failure
  rates and writes `workflow` recommendations.
- `@adaptivemcp/approval` enforces intent → plan → tool boundaries via the
  `ApprovalGate` (allow / deny / require_confirmation) and writes `approval`
  recommendations.

## Phase 3: Thin client and production hardening (complete)

- `@adaptivemcp/thin-client`: client-side execution loop with approval gate +
  store-derived retry policy; transport stays with the official MCP SDK.
- Persistence: file-backed SQLite by default (`:memory:` for tests).
- Observability: the store is exposed as the `dev.adaptivemcp/tools-metadata` MCP
  resource and as a derived YAML file.

## Phase 4: Extension spec alignment (complete)

- A **narrow, server-governed** MCP extension is proposed: the
  `dev.adaptivemcp/tools-metadata` resource a server publishes to **govern** tool
  adaptation (annotations, budgets, required approvals), with the client learning
  dynamically and reporting observations back. The draft lives at
  `docs/sep-2133-tools-metadata.md`.
- The client-side learning packages use internal `dev.adaptivemcp/<name>`
  identifiers for namespacing but are NOT advertised as MCP extensions.
- See the main README for how to advertise the extension in `initialize`
  capabilities (the `@modelcontextprotocol/sdk` already includes `extensions` in
  its `ServerCapabilities` schema).

## Phase 5: Extensible middleware (complete)

Make the middleware layer pluggable so external integrations — **rtk**
(CLI-output compression), **headroom** (generic content compression), and a later
**client OAuth delegation** flow — can attach to `AdaptiveRuntime` and/or
`ThinClient` without forking the core packages. Full analysis, integration
mapping, and open decisions (D1–D10, with pros/cons) live in `docs/doubts.md` §12.

**Integration model (decided): middleware chains MCP servers, not binaries.**
- `@adaptivemcp/middleware`: new package holding the `Middleware` plugin
  interface (`init` / `beforeCall` / `afterCall` / `onError` / `contributeView`)
  and a `MiddlewareChain`. Depends only on the `Store` interface from `spec`.
  Adds a transport-agnostic `Compressor` abstraction (`compress(content, opts) →
  { compressed, hash, savings_percent }`) whose implementation is **MCP-client
  backed** (chains to a compressor MCP server).
- `@adaptivemcp/mcp-binary` (NEW): a generic **CLI-binary → MCP-server wrapper**
  (stdio). This is the *only* sanctioned shell-out layer (doubts.md §12b). It
  exposes a binary's CLI as MCP tools (e.g. rtk → `rtk_exec(command)`), so
  binaries like rtk become chainable through the same `MiddlewareChain` seam
  instead of being stuck at the host layer or shelling out inside core.
- `AdaptiveRuntime` and `ThinClient` each hold a `MiddlewareChain` and invoke it
  around execution. Existing `ApprovalGate`/`Router`/`Orchestrator` stay as
  built-ins (no breaking change) and may later be wrapped as middleware.
- **Prerequisite code gaps:** carry `output` through the loop (`ToolHandler` →
  `ThinClient.run` → `record` → `observeCompleted` → `ToolExecutionEvent.output`);
  stop hardcoding `output: { ok: true }` in `observeCompleted`; add a `middleware`
  map to `ToolMetadataView` so `contributeView` results surface in
  `tools-metadata.yaml`; add the `Compressor` abstraction + `HeadroomMiddleware`
  (MCP or SDK backed) and the `@adaptivemcp/mcp-binary` package + `RtkWrapper`.
- **Integrations:**
  - **headroom** → `afterCall` Transform I/O middleware via `Compressor`
    (recommended: MCP-client to `headroom_compress`; lighter alt: headroom-ai TS
    SDK `compress()`). Surface `hash` + `savings_percent` via `contributeView` so
    the agent can later call `headroom_retrieve` for originals.
  - **rtk** → wrapped into an MCP server by `@adaptivemcp/mcp-binary`, then
    chained as a `command-output` middleware (only for shell-like MCP tools, e.g.
    a `run_shell_command` tool). No shelling inside core.
  - **client OAuth** → `beforeCall` credential-injection hook point.
- **Resolved decisions (see doubts.md §12e):** D1 full output plumbing, D2 explicit
  `use()` API, D3 `middleware` YAML map, D4 rtk wrapped into MCP (not host-layer
  only), D5 fixed ordering, D6 built-ins kept alongside, D7 Compressor via
  MCP-chaining, D8 CCR hash surfaced in YAML, D9 passthrough on compress failure,
  D10 generic CLI→MCP wrapper contract.

### How MCP chaining actually works (clarity)

**We chain MCP servers, not binaries.** A `MiddlewareChain` is a list of
`Middleware` plugins invoked around a tool call: `beforeCall` in registration
order, `afterCall` in reverse. Each middleware sees the output the previous one
produced. The binary wrapper is just *one* node that turns a CLI subprocess into
an MCP tool so it can sit in that chain. Adding rtk to the chain does **not**
inject rtk into every other tool — only the tools you explicitly route through
the rtk middleware are affected.

**Two distinct layers for rtk:**
- *Agent Bash layer* — rtk's own PreToolUse hook (`rtk init -g`) rewrites Bash
  calls like `git status` → `rtk git status` *before* they run. This is rtk's
  feature, not ours.
- *MCP tool-output layer* — our `rtk_exec` middleware spawns `rtk gain <cmd>`
  *after* a tool returns, compressing what the result carries back.

These compose rather than conflict. Adaptive MCP never installs, enables, or
disables the rtk hook; it only reuses the rtk binary if already present.

**Graceful coexistence when rtk is already installed:** `resolveRtkCommand()`
looks up the user's existing `rtk` on `PATH` (read-only, never installs a second
copy), verifies it is rtk-ai via `rtk --version` (guarding against the unrelated
Rust *Type Kit* crate that also ships a `rtk` binary), and if missing/wrong
reports `missing`/`wrong-package` so the wrapper degrades to a clear setup
message instead of spawning a missing binary. Adaptive MCP is therefore **not a
nuisance** to other MCPs: it chains via MCP and leaves the user's shell and other
servers alone. See `packages/mcp-binary/README.md`.

## Phase 6: Lessons from host harnesses (planned, 2026-07-22)

Prompted by a review of [OpenCode](https://github.com/anomalyco/opencode)
(opencode.ai) — a mature, static-config coding-agent harness. OpenCode has no
learning loop (its permission rules are hand-written), but its host-level
concepts expose gaps in what Adaptive MCP currently observes and models. Each
item below is independent and can ship on its own.

### 6a. Host adapter: prove the loop on a real harness

Everything so far is validated by `examples/` scenarios (synthetic telemetry),
never by a real agent host. OpenCode's plugin system already exposes the hook
shape Adaptive MCP's `@adaptivemcp/middleware` `Middleware` interface mirrors
(`beforeCall`/`afterCall` ≈ OpenCode's `tool.execute.before`/`tool.execute.after`),
loaded from `.opencode/plugins/` or an npm package.

- New package: `@adaptivemcp/opencode-plugin` — maps OpenCode's
  `tool.execute.before`/`tool.execute.after` hooks onto
  `TelemetryRecorder`/`MiddlewareChain`, and `session.*` hooks onto the
  session-tagging work in 6e.
- Follows the mcp-binary precedent: a thin, sanctioned adapter at the edge: no
  core package depends on it.
- This is the highest-leverage item: it is the difference between "library with
  good internal design" and something that learns from a real, popular agent
  instead of only local demos.

### 6b. `repetition_detected` insight (doom-loop, but learned)

OpenCode's `doom_loop` guard is a static heuristic: N identical calls in a row
→ `ask`/`deny`. `@adaptivemcp/evaluation` currently only derives
`observed_failure_rate` / `avg_duration_ms` from aggregate `ToolStats`, nothing
from event *sequences*.

- Add a `repetition_detected` `Insight` computed from consecutive identical
  `(toolName, serverName, input-hash)` events in the telemetry stream, not just
  aggregate counters.
- Feeds `ApprovalGate` the same way `failureRate` does today: cross a
  threshold → `require_confirmation`.
- Directly serves the AGENTS.md open question *"can workflows emerge from
  telemetry?"*

### 6c. Context-cost as a tracked dimension

OpenCode explicitly warns that MCP servers "add to context" and lets users
disable whole tool namespaces to control it. `ToolStats` tracks `totalCost`
(money) and `avgDurationMs` but nothing about token/context size — so the
derived YAML currently has no way to ever recommend "this tool is verbose,
disable it," the thing OpenCode users do by hand today via
`"tools": { "my-mcp*": false }`.

- Extend `ToolStats` (`@adaptivemcp/spec`) with a context-size field (e.g.
  `avgOutputTokens` or `avgOutputBytes`).
- New evaluation insight: `context_cost_high` once a tool's average output
  crosses a configurable threshold.
- Pairs naturally with the ROADMAP's existing "cost drift" idea (see What's
  Next in the README).

### 6d. Pattern matching in `ApprovalPolicy`

`ApprovalPolicy.denyTools` / `confirmRiskLevels` (`packages/approval/src/gate.ts`)
match exact tool names only. OpenCode's permission config matches tool/command
*patterns* with last-match-wins (`"git *": "allow"`, `"rm *": "deny"`), and its
MCP tool-disabling config uses the same glob approach per server namespace
(`"my-mcp*": false`).

- Add glob matching to `denyTools` (and optionally `confirmRiskLevels`) so one
  entry can cover a whole noisy server (e.g. `"flaky-server/*"`) instead of
  enumerating every tool name.
- Keep `ApprovalGate.gate()`'s existing precedence order (deny → risk annotation
  → learned failure rate → allow); only the matching mechanism changes.

### 6e. Session-scoped telemetry

OpenCode treats sessions as first-class (`session.created` / `session.idle` /
`session.compacted` / `session.deleted`). Adaptive MCP's telemetry is per-invocation
with no session tag, so there is currently no data model to answer the
AGENTS.md open question *"which tools naturally cluster together?"* — the data
needed to compute co-occurrence doesn't exist yet.

- Add an optional `sessionId` to `ToolExecutionEvent` (`@adaptivemcp/spec`) and
  thread it through `TelemetryRecorder`.
- New evaluation pass: co-occurrence of tools within the same `sessionId`,
  surfaced as a `Recommendation` (`type: "workflow"`?) or a new insight —
  exact shape TBD, needs a design pass before implementation.
- Depends on 6a for a real source of session boundaries (OpenCode's
  `session.*` hooks); the synthetic examples have no session concept to hang
  this off of otherwise.


