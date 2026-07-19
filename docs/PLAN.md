# Adaptive MCP — Implementation Plan

This document tracks the phased implementation of Adaptive MCP. It is a living
plan: each phase is validated by runnable examples before the next begins.

## Guiding constraints

- **Node 26 only.** No LTS, no other `fnm` versions. The built-in `node:sqlite`
  module is stable in Node 26 (no flag required).
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

## Phase 0 — Foundation (complete)

- Monorepo: pnpm workspaces, TypeScript strict, ESLint 9, Prettier, Vitest,
  Changesets.
- `@adaptivemcp/spec`: `ToolRecord`, `ToolStats`, `Insight`, `Recommendation`,
  `Annotation`, event schema, extension namespace `dev.adaptivemcp/` (SEP-2133\n  reversed-domain identifiers).
- `@adaptivemcp/memory`: `MemoryStore` over `node:sqlite` with `tools` table.

## Phase 1 — Observation → SSOT → View (complete)

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

## Phase 2 — Recommendations & routing (complete)

- `@adaptivemcp/evaluation` emits `Recommendation`s (e.g. "add retry",
  "flag high-risk") into the SSOT.
- `@adaptivemcp/routing` consumes stats + insights to suggest model/budget
  choices; surfaces them in the YAML `recommendations` list.
- `@adaptivemcp/orchestration` derives retry policies from observed failure
  rates and writes `workflow` recommendations.
- `@adaptivemcp/approval` enforces intent → plan → tool boundaries via the
  `ApprovalGate` (allow / deny / require_confirmation) and writes `approval`
  recommendations.

## Phase 3 — Thin client & production hardening (complete)

- `@adaptivemcp/thin-client`: client-side execution loop with approval gate +
  SSOT-derived retry policy; transport stays with the official MCP SDK.
- Persistence: file-backed SQLite by default (`:memory:` for tests).
- Observability: the SSOT is exposed as the `dev.adaptivemcp/tools-metadata` MCP
  resource and as a derived YAML file.

## Phase 4 — Extension spec alignment (complete)

- A **narrow, server-governed** MCP extension is proposed (SEP-2133): the
  `dev.adaptivemcp/tools-metadata` resource a server publishes to **govern** tool
  adaptation (annotations, budgets, required approvals), with the client learning
  dynamically and reporting observations back. The draft lives at
  `docs/sep-2133-tools-metadata.md`.
- The client-side learning packages use internal `dev.adaptivemcp/<name>`
  identifiers for namespacing but are NOT advertised as MCP extensions.
- See the main README for how to advertise the extension in `initialize`
  capabilities once the MCP SDK supports the `extensions` capability map.

## How to run

```bash
pnpm install
pnpm -r run build

# Improvement-over-time scenario (prints YAML after each phase):
cd examples && node dist/scenario.js

# MCP server + client over stdio:
node dist/client.js   # local loop
node -e "import('./dist/client.js').then(m=>m.runClient())"  # real stdio client
```

## Phase 5 — Submit the SEP to the MCP org (walkthrough)

> Research basis: the official process is documented at
> `modelcontextprotocol.io/community/sep-guidelines` and
> `modelcontextprotocol.io/extensions/overview`. SEPs are markdown files in the
> `seps/` directory of `github.com/modelcontextprotocol/modelcontextprotocol`.
> Our proposal is an **Extensions Track** SEP (per SEP-2133). Note SEP-2133 also
> permits **unofficial** extensions governed outside the MCP org — owning
> `adaptivemcp.dev` already satisfies the `dev.adaptivemcp/` namespace rule, so
> submission is only required if we want MCP-org recognition (experimental →
> official). This walkthrough covers that path.

### Step 0 — Decide whether to submit at all

- **Stay unofficial (current state):** we already comply with SEP-2133 by using
  the `dev.adaptivemcp/` reversed-domain prefix. No PR needed; ship the
  `@adaptivemcp/extension` package and document the resource. Lowest friction.
- **Seek MCP recognition:** follow Steps 1–9 to land an experimental/official
  extension. Required if we want it listed under `io.modelcontextprotocol` or
  promoted via the `ext-` repositories.

### Step 1 — Align with design principles & find a group

- Read `modelcontextprotocol.io/community/design-principles`. Our proposal maps
  cleanly onto **Composability over specificity** (built from Resources, not new
  primitives), **Interoperability over optimization** (graceful degradation), and
  **Demonstration over deliberation** (we have a runnable prototype).
- Extensions **must have an associated Working Group or Interest Group**. If none
  fits (e.g. "adaptive/server-governed tool metadata"), raise it in
  [GitHub Discussions](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions)
  or `#general` on [Discord](https://modelcontextprotocol.io/community/communication#discord).
  Enough interest → create an Interest Group (good signal of traction before a
  cold submission).

### Step 2 — Write the SEP file in the canonical format

- Create `seps/0000-tools-metadata-governance.md` (the `0000` is a placeholder;
  the number is assigned from the PR number later).
- Use the SEP-2133 header style:

  ```markdown
  # SEP-0000: Server-Governed Tool Metadata (dev.adaptivemcp/tools-metadata)

  - **Status**: Draft
  - **Type**: Extensions Track
  - **Created**: 2026-07-19
  - **Author(s)**: <your GitHub handle>
  - **Sponsor**: None (seeking sponsor)
  - **PR**: <filled in after Step 3>

  ## Abstract
  ## Motivation
  ## Specification   # MUST use RFC 2119 language (MUST / SHOULD / MAY)
  ## Rationale
  ## Backward Compatibility
  ## Reference Implementation
  ## Security Implications
  ```

- Our `docs/sep-2133-tools-metadata.md` already covers Abstract → Security;
  port it into this structure and convert normative statements to RFC 2119
  keywords. Keep the `dev.adaptivemcp/tools-metadata` resource URI and the
  `notifications/message` (or `report_observation` tool) reporting channel.

### Step 3 — Open the pull request

- Fork `modelcontextprotocol/modelcontextprotocol`, push the file, open a PR
  **adding only the SEP markdown** to `seps/`.
- **Rename the file to the PR number** (e.g. PR #1850 → `1850-tools-metadata-governance.md`)
  and update the `SEP-0000` header to `SEP-1850` + the PR link. This is how the
  SEP number is assigned.
- Follow the PR template and disclose any AI assistance (per `AI_POLICY.md`).

### Step 4 — Find a Sponsor

- Tag 1–2 **Core Maintainers / Maintainers** from `MAINTAINERS.md` whose area
  matches (server governance / extensions). Share the PR in the relevant Discord
  channel.
- If no response in 2 weeks, ask in `#general`. A SEP with no sponsor within
  6 months becomes `dormant` (revivable, not rejected).

### Step 5 — Sponsor sets `draft`, informal review

- The sponsor assigns themselves and sets `Status: Draft`. They review and may
  request changes via PR comments. Iterate here.

### Step 6 — Formal review (`in-review`)

- When ready, the sponsor sets `Status: in-review`. Core Maintainers review it
  in their **biweekly** meeting.
- Acceptance criteria: (1) a **prototype implementation** demonstrating the
  proposal, (2) clear ecosystem benefit, (3) community support/consensus.
- **We already satisfy (1):** `@adaptivemcp/extension` renders the resource and
  the `examples/` scenarios prove the mechanics end-to-end. Link the repo in
  *Reference Implementation*.

### Step 7 — Resolution

- Outcome is `accepted`, `rejected`, or returned for revision. If rejected,
  address feedback and resubmit (rejection is not permanent).

### Step 8 — Finalize (`final`)

- After `accepted`, complete the reference implementation (ours is essentially
  done) and, **if the SEP introduces observable protocol behavior**, merge a
  **conformance scenario** into `github.com/modelcontextprotocol/conformance`
  with a `sep-NNNN.yaml` traceability file mapping every MUST/MUST NOT/SHOULD to
  a check. Our proposal is mostly a Resource + best-effort notifications, so it
  may qualify for the "no observable protocol behavior" exemption — confirm with
  the sponsor.
- Sponsor sets `Status: Final`.

### Step 9 — Publish as an extension (if pursuing official status)

- Open a PR to add the extension to the relevant `ext-` repository (or create an
  `experimental-ext-` repo during incubation, tied to the IG/WG from Step 1).
- Remember: extensions are **always disabled by default / opt-in**, and evolve
  via capability flags or versioned settings — breaking changes use a new
  identifier (e.g. `dev.adaptivemcp/tools-metadata-v2`).

### Checklist before submitting

- [ ] Proposal aligns with MCP design principles (Step 1)
- [ ] Associated WG/IG exists or is proposed (Step 1)
- [ ] SEP file uses canonical header + RFC 2119 language (Step 2)
- [ ] Runnable prototype linked (ours: `@adaptivemcp/extension` + `examples/`)
- [ ] PR opened, file renamed to PR number, AI disclosure added (Steps 3–4)
- [ ] Sponsor identified and tagged (Step 4)
