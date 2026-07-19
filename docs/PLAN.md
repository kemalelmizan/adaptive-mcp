# Adaptive MCP — Implementation Plan

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
  capabilities (the `@modelcontextprotocol/sdk` already includes `extensions` in
  its `ServerCapabilities` schema).

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

## Phase 6 — Publish the packages to npm (walkthrough)

> Scope: publish the **core subset** under the `@adaptivemcp` npm organization
> (`https://www.npmjs.com/org/adaptivemcp`). The publishable set is defined once
> in `scripts/lib/workspace.ts` as `PUBLISHABLE_PACKAGES`:
> `spec · memory · telemetry · evaluation · extension`. `routing`,
> `orchestration`, `approval`, `thin-client`, `examples`, and `apps` stay
> private. All distribution is driven by the `scripts/` runners — there is no
> manual `npm publish` by hand.

### Prerequisites

- **Node 26** and **pnpm 11.14.0** (the repo's `packageManager` field pins pnpm).
- An npm account that owns or belongs to the **`@adaptivemcp`** organization
  (create it first at `https://www.npmjs.com/org/adaptivemcp` if it does not
  exist yet).
- `NPM_TOKEN` with publish rights to the org, available in the environment (CI
  secret or local shell). The token is read by `npm publish` automatically.
- A clean working tree (`git status --porcelain` empty) — the scripts refuse to
  release otherwise.

### Step 1 — Verify the release surface

```bash
node scripts/maintenance.ts status      # versions + dist state per package
node scripts/maintenance.ts stale-dist  # fail if any package lacks dist/
node scripts/maintenance.ts check       # build + lint + test gate (CI-equivalent)
```

All publishable packages must show `built` and the check must pass. Fix any
missing `dist/` by running `node scripts/build.ts` first.

### Step 2 — Author a Changeset

Each meaningful change ships with a changeset so versions and CHANGELOGs stay
accurate:

```bash
pnpm changeset        # pick the affected @adaptivemcp/* packages + semver bump
git add .changeset && git commit -m "chore: changeset for <scope>"
```

`release.ts` runs `changeset version` to apply pending changesets and bump
versions. **Do not** run `changeset version` by hand before releasing — let the
script own that step so the bump and the publish stay in one flow.

### Step 3 — Dry run (no publish)

```bash
node scripts/release.ts --dry-run
```

This builds the publishable packages, applies pending changesets, rebuilds, and
stops before `npm publish`. Inspect the version bumps and the emitted `dist/`
outputs. Nothing is pushed or published.

### Step 4 — Publish

```bash
export NPM_TOKEN=...        # org-scoped publish token
node scripts/release.ts     # version + build + npm publish (--access public)
```

What the script does, in order:

1. Refuses if the working tree is dirty.
2. Builds `PUBLISHABLE_PACKAGES` (`pnpm -r --filter … run build`).
3. Applies pending changesets (`pnpm changeset version`).
4. Rebuilds (the version bump may change emitted code).
5. `npm publish --access public --ignore-scripts` for each package, in
   dependency order (`spec` → `memory` → `telemetry` → `evaluation` →
   `extension`).

`--ignore-scripts` keeps publish hermetic (no postinstall in the published
tarball). The script never commits the version bump or pushes tags — that is
left to the caller (e.g. a Changesets release CI workflow) to keep history clean.

### Step 5 — Record the release

```bash
git add -A && git commit -m "release: @adaptivemcp/* vX.Y.Z"
git tag -a vX.Y.Z -m "release: @adaptivemcp/* vX.Y.Z"
git push --follow-tags
```

The `release.ts` output prints the version; mirror it in the commit/tag message.

### Step 6 — Verify on npm

- Check each package page under `https://www.npmjs.com/org/adaptivemcp` shows
  the new version.
- Sanity-check a fresh install in a temp dir:
  ```bash
  npm view @adaptivemcp/extension version
  ```

### Publish checklist

- [ ] `node scripts/maintenance.ts check` passes (Step 1)
- [ ] Changeset authored for the change (Step 2)
- [ ] `--dry-run` inspected and clean (Step 3)
- [ ] `NPM_TOKEN` set with org publish rights (Step 4)
- [ ] `node scripts/release.ts` succeeded; versions bumped (Step 4)
- [ ] Version commit + tag pushed (Step 5)
- [ ] Packages visible on npmjs `@adaptivemcp` org (Step 6)

### Notes / guardrails

- **Only the 5 core packages publish.** To add one (e.g. promote `routing`), add
  it to `PUBLISHABLE_PACKAGES` in `scripts/lib/workspace.ts` and ensure its
  `package.json` has no `"private": true` and a `files: ["dist"]` allowlist.
- **Never publish by hand.** The scripts guarantee dependency order and a clean
  tree; ad-hoc `npm publish` can skip the version bump or break ordering.
- **`--no-version`** publishes the current versions as-is (skips `changeset
  version`) — only for re-publishing an already-bumped state.
