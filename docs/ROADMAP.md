# Adaptive MCP: Implementation Plan

This document tracks the phased implementation of Adaptive MCP. It is a living
plan: each phase is validated by runnable examples before the next begins.

## Guiding constraints

- **Node 22+** (Node 26 recommended)
- **pnpm 11.14.0** (pinned via the repo's `packageManager` field).
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
| `@adaptivemcp/runtime` | Batteries-included `AdaptiveRuntime` wiring all packages | ✅ done |
| `examples` | Runnable server + client + scenarios | ✅ done |

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

## Phase 5: Extensible middleware (planned)

Make the middleware layer pluggable so external integrations — **rtk**
(CLI-output compression), **headroom** (generic content compression), and a later
**client OAuth delegation** flow — can attach to `AdaptiveRuntime` and/or
`ThinClient` without forking the core packages. Full analysis, integration
mapping, and open decisions (D1–D6, with pros/cons) live in `meta/doubts.md` §12.

- `@adaptivemcp/middleware`: new package holding the `Middleware` plugin
  interface (`init` / `beforeCall` / `afterCall` / `onError` / `contributeView`)
  and a `MiddlewareChain`. Depends only on the `Store` interface from `spec`.
- `AdaptiveRuntime` and `ThinClient` each hold a `MiddlewareChain` and invoke it
  around execution. Existing `ApprovalGate`/`Router`/`Orchestrator` stay as
  built-ins (no breaking change) and may later be wrapped as middleware.
- **Prerequisite code gaps:** carry `output` through the loop (`ToolHandler` →
  `ThinClient.run` → `record` → `observeCompleted` → `ToolExecutionEvent.output`);
  stop hardcoding `output: { ok: true }` in `observeCompleted`; add a `middleware`
  map to `ToolMetadataView` so `contributeView` results surface in
  `tools-metadata.yaml`.
- **Integrations:** headroom → `afterCall` output-transform; rtk → `afterCall`
  output-transform (isolated in the integration layer; shelling out permitted
  only there); client OAuth → `beforeCall` credential-injection hook point.
- **Open decisions (confirm before implementation, see doubts.md §12e):** D1
  output-plumbing scope, D2 registration API vs auto-discovery, D3 YAML
  contribution shape, D4 rtk placement, D5 ordering semantics, D6 backward
  compatibility.


