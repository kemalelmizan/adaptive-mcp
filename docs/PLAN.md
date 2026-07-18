# Adaptive MCP — Implementation Plan

This document tracks the phased implementation of Adaptive MCP. It is a living
plan: each phase is validated by runnable examples before the next begins.

## Guiding constraints

- **Node 26 only.** No LTS, no other `fnm` versions. All run scripts use
  `node --experimental-sqlite` (the built-in `node:sqlite` module is the SSOT).
- **pnpm 11.14.0** (latest available in this registry; `pnpm@12` does not exist).
- **SQLite is the single source of truth (SSOT).** The `tools-metadata.yaml`
  file is a *derived view* of the SQLite store, never edited directly.
- **Adaptive MCP computes and writes the YAML.** MCP clients read the YAML as a
  static, human- and machine-readable projection of learned behavior.
- **MCP extension pattern.** Adaptive behavior lives in middleware packages, not
  in the server. Servers stay stateless and lightweight.

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
MCP resource: adaptive://tools-metadata.yaml
```

| Package | Responsibility | Status |
| --- | --- | --- |
| `@adaptivemcp/spec` | Extension identifiers, event schemas, shared types | ✅ done |
| `@adaptivemcp/memory` | SQLite SSOT store (`node:sqlite`) | ✅ done |
| `@adaptivemcp/telemetry` | Recorder + memory-backed store + queries | ✅ done |
| `@adaptivemcp/evaluation` | Insight generation from observed stats | ✅ done |
| `@adaptivemcp/extension` | Derives + writes `tools-metadata.yaml` view | ✅ done |
| `@adaptivemcp/routing` | Model selection / budget optimization | ⬜ stub |
| `@adaptivemcp/orchestration` | Execution composition / retries | ⬜ stub |
| `@adaptivemcp/approval` | Intent → plan → tool approval research | ⬜ stub |
| `@adaptivemcp/thin-client` | Transport + middleware hooks | ⬜ stub |
| `examples` | Runnable server + client + scenarios | ✅ done |

## Phase 0 — Foundation (complete)

- Monorepo: pnpm workspaces, TypeScript strict, ESLint 9, Prettier, Vitest,
  Changesets.
- `@adaptivemcp/spec`: `ToolRecord`, `ToolStats`, `Insight`, `Recommendation`,
  `Annotation`, event schema, extension namespace `adaptive://`.
- `@adaptivemcp/memory`: `MemoryStore` over `node:sqlite` with `tools` table.

## Phase 1 — Observation → SSOT → View (complete)

- `@adaptivemcp/telemetry`: `TelemetryRecorder` + `MemoryBackedTelemetryStore`
  that folds events into the SSOT via `memory.recordExecution`.
- `@adaptivemcp/evaluation`: `Evaluator` emits `observed_failure_rate` and
  `avg_duration_ms` insights once a confidence threshold is met.
- `@adaptivemcp/extension`: `ExtensionController` renders the SSOT to
  `tools-metadata.yaml` and exposes it as the `adaptive://tools-metadata.yaml`
  MCP resource.

**Validated by:** `examples` scenario (healthy → flaky → fixed) and the
stdio server/client example. The YAML view evolves automatically; the human
`annotation.risk` field stays static.

## Phase 2 — Recommendations & routing (next)

- `@adaptivemcp/evaluation` emits `Recommendation`s (e.g. "add retry",
  "flag high-risk") into the SSOT.
- `@adaptivemcp/routing` consumes stats + insights to suggest model/budget
  choices; surfaces them in the YAML `recommendations` list.
- Extend the YAML view schema with a richer `recommendations` section.

## Phase 3 — Orchestration & approval (research)

- `@adaptivemcp/orchestration`: retries / planning experiments driven by
  insights.
- `@adaptivemcp/approval`: explore intent → plan → tool boundaries; decide what
  humans approve and whether approval can adapt.

## Phase 4 — Thin client & production hardening

- `@adaptivemcp/thin-client`: transport + capability negotiation + middleware
  hooks so the adaptation loop runs on the client side.
- Persistence: file-backed SQLite by default; migrations; retention policy for
  telemetry.
- Observability: expose the SSOT as additional MCP resources/prompts.

## How to run

```bash
eval "$(fnm env)" && fnm use 26
pnpm install
pnpm -r run build

# Improvement-over-time scenario (prints YAML after each phase):
cd examples && node --experimental-sqlite dist/scenario.js

# MCP server + client over stdio:
node --experimental-sqlite dist/client.js   # local loop
node -e "import('./dist/client.js').then(m=>m.runClient())"  # real stdio client
```
