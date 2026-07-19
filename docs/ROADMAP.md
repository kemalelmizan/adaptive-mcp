# Adaptive MCP: Implementation Plan

This document tracks the phased implementation of Adaptive MCP. It is a living
plan: each phase is validated by runnable examples before the next begins.

## Guiding constraints

- **Node 26 only.** No LTS, no other `fnm` versions. The built-in `node:sqlite`
  module is available without the `--experimental-sqlite` flag in Node 26.
- **pnpm 11.14.0** (pinned via the repo's `packageManager` field).
- **SQLite is the single source of truth (SSOT).** The `tools-metadata.yaml`
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

## Architecture

```text
Tool execution (MCP server)
        │
        ▼
Telemetry  ──records event──▶  MemoryStore (SQLite SSOT)
        │                            │
        │                            ▼
        │                     Evaluation  ──insights──▶  MemoryStore
        │                            │
        ▼                            ▼
ExtensionController  ◀──  reads SSOT  ──▶  tools-metadata.yaml (view)
        │
        ▼
MCP resource: dev.adaptivemcp/tools-metadata
```

| Package | Responsibility | Status |
| --- | --- | --- |
| `@adaptivemcp/spec` | Extension identifiers, event schemas, shared types | ✅ done |
| `@adaptivemcp/memory` | SQLite SSOT store (`node:sqlite`) | ✅ done |
| `@adaptivemcp/telemetry` | Recorder + memory-backed store + queries | ✅ done |
| `@adaptivemcp/evaluation` | Insight generation from observed stats | ✅ done |
| `@adaptivemcp/extension` | Derives + writes `tools-metadata.yaml` view | ✅ done |
| `@adaptivemcp/routing` | Model selection / budget optimization | ✅ done |
| `@adaptivemcp/orchestration` | Execution composition / retries | ✅ done |
| `@adaptivemcp/approval` | Intent → plan → tool approval gate | ✅ done |
| `@adaptivemcp/thin-client` | Client-side execution loop + middleware hooks | ✅ done |
| `examples` | Runnable server + client + scenarios | ✅ done |

## Phase 0: Foundation (complete)

- Monorepo: pnpm workspaces, TypeScript strict, ESLint 9, Prettier, Vitest,
  Changesets.
- `@adaptivemcp/spec`: `ToolRecord`, `ToolStats`, `Insight`, `Recommendation`,
  `Annotation`, event schema, extension namespace `dev.adaptivemcp/` (SEP-2133 reversed-domain identifiers).
- `@adaptivemcp/memory`: `MemoryStore` over `node:sqlite` with `tools` table.

## Phase 1: Observation to SSOT to View (complete)

- `@adaptivemcp/telemetry`: `TelemetryRecorder` + `MemoryBackedTelemetryStore`
  that folds events into the SSOT via `memory.recordExecution`.
- `@adaptivemcp/evaluation`: `Evaluator` emits `observed_failure_rate` and
  `avg_duration_ms` insights once a confidence threshold is met.
- `@adaptivemcp/extension`: `ExtensionController` renders the SSOT to
  `tools-metadata.yaml` and exposes it as the `dev.adaptivemcp/tools-metadata`
  MCP resource.

**Validated by:** `examples` scenario (healthy → flaky → fixed) and the
stdio server/client example. The YAML view evolves automatically; the human
`annotation.risk` field stays static.

## Phase 2: Recommendations and routing (complete)

- `@adaptivemcp/evaluation` emits `Recommendation`s (e.g. "add retry",
  "flag high-risk") into the SSOT.
- `@adaptivemcp/routing` consumes stats + insights to suggest model/budget
  choices; surfaces them in the YAML `recommendations` list.
- `@adaptivemcp/orchestration` derives retry policies from observed failure
  rates and writes `workflow` recommendations.
- `@adaptivemcp/approval` enforces intent → plan → tool boundaries via the
  `ApprovalGate` (allow / deny / require_confirmation) and writes `approval`
  recommendations.

## Phase 3: Thin client and production hardening (complete)

- `@adaptivemcp/thin-client`: client-side execution loop with approval gate +
  SSOT-derived retry policy; transport stays with the official MCP SDK.
- Persistence: file-backed SQLite by default (`:memory:` for tests).
- Observability: the SSOT is exposed as the `dev.adaptivemcp/tools-metadata` MCP
  resource and as a derived YAML file.

## Phase 4: Extension spec alignment (complete)

- A **narrow, server-governed** MCP extension is proposed (SEP-2133): the
  `dev.adaptivemcp/tools-metadata` resource a server publishes to **govern** tool
  adaptation (annotations, budgets, required approvals), with the client learning
  dynamically and reporting observations back. The draft lives at
  `docs/sep-2133-tools-metadata.md`.
- The client-side learning packages use internal `dev.adaptivemcp/<name>`
  identifiers for namespacing but are NOT advertised as MCP extensions.
- See the main README for how to advertise the extension in `initialize`
  capabilities (the `@modelcontextprotocol/sdk` already includes `extensions` in
  its `ServerCapabilities` schema).


