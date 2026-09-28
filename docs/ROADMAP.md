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
| `@adaptivemcp/extension` | Derives + writes `tools-metadata.yaml` view; execution-graph/workflow-graph/graph-insights MCP resources | ✅ done |
| `@adaptivemcp/graph-analysis` | `GraphAnalyzer` — critical path, bottlenecks, failure cascades, causal analysis, anti-patterns, forecasting | ✅ done |
| `@adaptivemcp/routing` | Model selection / budget optimization; position-aware routing (critical path vs. leaf) | ✅ done |
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

> One follow-up from this phase is still open and tracked in Phase 6:
> graduating the SEP to Final is blocked on an upstream SDK PR (see
> "Blocked / external dependency" at the end of Phase 6). Emitting
> `budget`/`require_approval` (6f) is done — see the Phase 6 table.

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

> The **client OAuth delegation** flow above only got the hook point (the
> `beforeCall` credential-injection seam); the actual flow was deliberately
> deferred ("design the hook point now, specify the exact flow later" —
> doubts.md §12). That flow is now tracked as Phase 6, item 6h.

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

## Phase 6: All remaining planned work (ordered by risk/effort, 2026-07-22)

This phase consolidates **every incomplete item scattered across this repo** —
the OpenCode-inspired gaps below, README's old "What's next" list, and the
deferred sub-items inside Phase 4/5 — into one place, so nothing incomplete is
tracked in three different documents. Five items (6a–6e) came from a review of
[OpenCode](https://github.com/anomalyco/opencode) (opencode.ai), a mature,
static-config coding-agent harness with no learning loop of its own but whose
host-level concepts expose gaps in what Adaptive MCP observes and models. The
rest (6f–6j) were already-known gaps that had no single home. Each item is
independent and can ship on its own unless a dependency is called out.

**Ordered low risk/low effort → high risk/high effort**, so the cheap,
self-contained wins land first. A separate "Blocked / external dependency"
list at the end holds items that cannot be scheduled by our own effort at all.

**Status review (2026-09-28).** Every item below was re-verified against the code
instead of taken at face value. Several had drifted stale: 6a, 6c, and 6f were
implemented but unmarked; 6d was implemented but unwired (now wired); 6b and 6e
remain partial (see the per-item status updates). To stop this recurring, the table's status markers are
now enforced by `scripts/check-docs.ts` (`pnpm docs:check`, also run by
`pnpm maintenance:check`), which fails the build if a documented capability and
its ROADMAP status disagree, if a package is missing from the publishable list
or the docs, or if a Phase 6/8 item row disappears.

| # | Item | Risk | Effort | Payoff |
| --- | --- | --- | --- | --- |
| 6a | ✅ done — Pattern matching in `ApprovalPolicy` | Low — isolated to `approval`, precedence order unchanged | Low — matcher shipped in `gate.ts`; regression test still to add | Medium — ergonomic, immediate |
| 6b | 🟡 partially done — Context-cost tracked dimension | Low — additive field, no external dependency | Low remaining — field + insight shipped; `context_cost_high` threshold not built | Medium — unlocks a recommendation type, but needs a real token/byte source to be useful |
| 6c | ✅ done — More insight types: cost drift, latency regression, approval friction | Low — additive, same shape as existing insights | Low/Medium — one evaluator pass per insight | Medium — broadens what the YAML surfaces, no new package |
| 6d | ✅ done — `repetition_detected` insight | Low — self-contained in `evaluation`, no schema break | Low — `detectRepetition()` wired into `evaluateWorkflow` | Medium/High — new capability, feeds `ApprovalGate` |
| 6e | 🟡 partially done — Conformance scenarios (graceful degradation) | Low — test-only, no production code changes | Low remaining — component-level tests exist; host-ignores-extension scenario still missing | Medium — confidence/trust, not new capability |
| 6f | ✅ done — Emit `budget` / `require_approval` in the reference impl | Medium — touches the wire schema tracked for SEP graduation | Medium — extend `ExtensionController` view + `spec` types | High — unblocks the SEP stabilization gate (see Blocked list) |
| 6g | 🟡 partially done — Multi-server aggregation (merge `tools-metadata` across servers) | Medium — key-collision handling across servers in `ExtensionController` | Low remaining — `ExtensionController.aggregateViews()` already implements the composite-key merge; needs tests + a consumer | Medium/High — real multi-server hosts need this |
| 6h | 🟡 partially done — Client OAuth delegation flow | Medium — credential handling is security-sensitive | Low remaining — `OAuthMiddleware` (`packages/thin-client/src/oauth-middleware.ts`) already implements authorize/callback/refresh/token-storage; needs test coverage and a real-provider validation pass | Medium — unblocks one integration, not the core loop |
| 6i | 🟡 partially done — Host adapter (OpenCode plugin) | Medium — depends on OpenCode's hook signatures | Low remaining — rewired to the real V1 hooks (`tool.execute.before`/`after`/`event`/`dispose`) with unit tests; has not been run against a live OpenCode host | High — proves the loop on a real, popular agent instead of only synthetic demos |
| 6j | Session-scoped telemetry | Medium/High — schema change threaded through `spec`/`telemetry`/`evaluation`; co-occurrence shape still TBD | Medium — `sessionId` already exists on `ToolExecutionEvent`/`ExecutionNode` and is threaded through `TelemetryRecorder`; only the co-occurrence evaluation pass itself is unbuilt | Medium — research-oriented (AGENTS.md open question), less immediately actionable; **depends on 6i** for real session boundaries |

### 6a. Pattern matching in `ApprovalPolicy`

**Status update (2026-09-28): implemented.** `ApprovalGate.gate()` now matches
`denyTools` entries as glob patterns via `matchGlob()` (`packages/approval/src/gate.ts`:
`*` = any chars, `?` = one char); `confirmRiskLevels` stays an exact list because
it selects risk *levels*, not tool names. Precedence is unchanged. Remaining gap:
the only exercise is the ad-hoc `examples/src/test-glob-deny.ts`, which isn't
wired into any script — add real glob cases to `packages/approval/src/gate.test.ts`.

Original design note below.

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

### 6b. Context-cost as a tracked dimension

**Status update (2026-09-28): partially done.** `ToolStats.avgOutputTokens`
(`packages/spec/src/types.ts`) is folded from events in
`packages/memory/src/store.ts` and surfaced by `evaluateRecord()` as the
`avg_output_tokens` insight (`packages/evaluation/src/evaluator.ts`). Still
missing: the threshold insight `context_cost_high` (and any recommendation that
acts on it). Original design note below.

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
- Pairs naturally with 6c's "cost drift" idea below.

### 6c. More insight types: cost drift, latency regression, approval friction

**Status update (2026-07-28): already done.** `evaluateRecord()`
(`packages/evaluation/src/evaluator.ts`, ~lines 321-469) already emits
`cost_drift`, `avg_cost_per_invocation`, `latency_regression`,
`avg_duration_ms_baseline`, and `approval_friction` for every tool crossing
`minInvocations * 2`. This entry was stale (found while scoping Phase 8);
kept below for history.

Formerly README's "What's next" list (now folded in here so planned work lives
in one document). Same shape as existing insights (`observed_failure_rate` /
`avg_duration_ms`) — trend/derived signals rather than new subsystems.

- **Cost drift**: flag a tool whose `totalCost`/invocation is trending up
  over a rolling window, not just its absolute value.
- **Latency regression**: flag a tool whose `avgDurationMs` has regressed
  vs. an earlier baseline window (distinct from the existing flat-average
  insight).
- **Approval friction**: track how often `ApprovalGate.gate()` returns
  `require_confirmation`/`deny` for a tool, surfaced as its own insight so
  the YAML shows not just "is this flaky" but "is this annoying to run."

### 6d. `repetition_detected` insight (doom-loop, but learned)

**Status update (2026-09-28): done.** `detectRepetition()`
(`packages/evaluation/src/evaluator.ts`) computes a `repetition_detected` insight
from repeated 2–4 tool subsequences in the execution graph (`count >= 3`) and is
now invoked by `evaluateWorkflow()` (so `evaluateAllWorkflows()` runs it per
session too); the insight is attributed to the workflow id, matching the other
workflow-level insights. Tests: `packages/evaluation/src/evaluator.test.ts`.
Remaining nice-to-have (not required for the item): let `ApprovalGate` consume
the insight. Original design note below.

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

### 6e. Conformance scenarios (graceful degradation)

**Status update (2026-09-28): partially done.** Component-level graceful
degradation is now covered by `packages/evaluation/src/conformance.test.ts`
(graph tracking off, closed store, malformed/null events, missing
recommendations, empty store, approval denial). Still missing: the scenario this
item actually asks for — a host that ignores the extension entirely (resource
never read, `report_observation` never called) with the base MCP server/client
asserted to still work. Original design note below.

Formerly README's "What's next" list. No host is required to understand the
`dev.adaptivemcp/tools-metadata` resource or the `report_observation` tool —
the whole design bets on graceful degradation for hosts that ignore unknown
resources. That claim is currently untested.

- Add `examples/src/scenarios/conformance.js`-style scenarios that simulate a
  host ignoring the extension entirely (resource never read, tool never
  called) and assert the base MCP server/client still work normally.
- Doubles as groundwork for the SEP graduation conformance suite referenced in
  doubts.md §6 (see the Blocked list below).

### 6f. Emit `budget` / `require_approval` in the reference impl

**Status update (2026-07-28): already done.** `packages/extension/src/view.ts`'s
`toToolMetadataView()` (~lines 64-77) already promotes `budget`/`require_approval`
from `routing`/`approval` recommendations into `ToolMetadataView.annotation`.
This entry was stale (found while scoping Phase 8); kept below for history.
Whether this actually unblocks the SEP stabilization gate mentioned below is a
separate question this update doesn't resolve.

Known gap from doubts.md §8 / §11: the reference impl (`@adaptivemcp/extension`)
does not yet emit the `budget` or `require_approval` fields in the
`tools-metadata` view, even though the SEP draft and the precedence rule
(host UI > suggestion > nothing) already assume they exist.

- Extend `ExtensionController`'s view projection + the relevant `spec` types to
  emit both fields once a `Router`/`ApprovalGate` recommendation exists for a
  tool.
- Until this ships, the precedence rule in `docs/sep-2133-tools-metadata.md`
  §Security is theoretical for those two fields — this item is a prerequisite
  for the upstream SDK PR gate (see Blocked list).

### 6g. Multi-server aggregation

Formerly README's "What's next" list. Today, `ExtensionController` derives one
`tools-metadata.yaml` per store; there's no notion of merging views **across**
multiple MCP servers into one aggregate a host could read in one place.

**Update (2026-07-30):** the merge itself already exists —
`ExtensionController.aggregateViews(stores, version?)`
(`packages/extension/src/controller.ts`) composes multiple `Store`s and
de-duplicates on the `(tool_name, server_name)` composite key, exactly the
collision rule described below. What's still missing:

- Test coverage — no test file references `aggregateViews` today.
- A real consumer/example — nothing in `examples/` or the docs calls it, so it
  hasn't been exercised end to end.

Original design note (still accurate): recall the `(tool_name, server_name)`
composite key exists specifically because two servers can expose a same-named
tool — the aggregation view needs to preserve that distinction, not flatten it.

### 6h. Client OAuth delegation flow

Phase 5 shipped the `beforeCall` credential-injection **hook point** for
middleware but deliberately deferred the actual OAuth flow ("design the hook
point now, specify the exact flow later" — doubts.md §12).

**Update (2026-07-30):** the flow itself has since been implemented —
`OAuthMiddleware` (`packages/thin-client/src/oauth-middleware.ts`) covers
`authorize`/`handleCallback` (with CSRF `state` validation), token refresh, and
pluggable token storage (`OAuthTokenStore`, with an `InMemoryOAuthTokenStore`
default). What's still missing:

- Test coverage — no test file references `OAuthMiddleware` today.
- Validation against a real OAuth provider (only unit-level logic has been
  reviewed, not an end-to-end authorize/callback/refresh cycle against a live
  server).
- Security-sensitive — this is the one item in Phase 6 that touches credential
  handling directly, hence the elevated risk grade despite the flow now being
  implemented.

### 6i. Host adapter: prove the loop on a real harness

Everything so far is validated by `examples/` scenarios (synthetic telemetry),
never by a real agent host. OpenCode's plugin system already exposes the hook
shape Adaptive MCP's `@adaptivemcp/middleware` `Middleware` interface mirrors
(`beforeCall`/`afterCall` ≈ OpenCode's `tool.execute.before`/`tool.execute.after`),
loaded from `.opencode/plugins/` or an npm package.

**Update (2026-09-28): rewired to the real V1 hooks and unit-tested.**
`@adaptivemcp/opencode-plugin` now exports a genuine OpenCode V1 `Plugin`
(`createAdaptivePlugin`) whose hooks are exactly the real ones — verified against
the reference source (`opencode` `packages/plugin/src/index.ts`, interface
`Hooks`): `tool.execute.before`, `tool.execute.after`, `event`, `dispose`. The
earlier cut invented `tool.execute.error` and `session.*` hooks that V1 does not
have, and never exported a host-shaped plugin. Now: telemetry + middleware run in
`tool.execute.before`/`tool.execute.after`; session ids come from
`session.created`/`session.updated`/`session.deleted` events; evaluation + view
sync are debounced off the hot path. Eight unit tests exercise the hooks against a
fake harness (`packages/opencode-plugin/src/plugin.test.ts`).

Still genuinely unproven:

- **Never run against a live OpenCode host** — hook shapes match the reference
  source, but no end-to-end plugin load has happened.
- **No per-tool error attribution** — V1 has no error hook, so failures require a
  host/event integration calling `recordToolFailure()`.
- **No execution-graph tracking** — V1 hooks expose no parent/child linkage.
- Highest ceiling of any Phase 6 item — the difference between "library with good
  internal design" and something that learns from a real, popular agent. See
  README's "Not yet published" section for the same caveat surfaced to users.

Historical note (2026-07-30): the first cut mapped `tool.execute.before`/
`tool.execute.after` onto `TelemetryRecorder`/`MiddlewareChain`/
`GraphTrackingMiddleware`/`OAuthMiddleware`, with 0 tests and synthetic hook
shapes.

### 6j. Session-scoped telemetry

OpenCode treats sessions as first-class (`session.created` / `session.updated` /
`session.deleted`, plus `session.error`). Adaptive MCP's telemetry needs a
session tag to answer the AGENTS.md open question *"which tools naturally
cluster together?"* — the co-occurrence analysis itself doesn't exist yet.

**Update (2026-07-30):** the data model is already in place —
`ToolExecutionEvent.sessionId` and `ExecutionNode.sessionId`
(`@adaptivemcp/spec`) exist today, and `TelemetryRecorder.completeNode`/
`failNode` already thread `sessionId` through into recorded events. What's
still missing:

- New evaluation pass: co-occurrence of tools within the same `sessionId`,
  surfaced as a `Recommendation` (`type: "workflow"`?) or a new insight —
  exact shape TBD, needs a design pass before implementation.
- Depends on 6i for a real source of session boundaries (OpenCode's
  `session.*` hooks); the synthetic examples have no session concept to hang
  this off of otherwise.

### Blocked / external dependency (not schedulable by our own effort)

These can't be ordered by risk/effort like 6a–6j because progress depends on
something outside this repo, not on engineering time spent here. Tracked in
full in `docs/doubts.md`.

- **Upstream SDK PR for SEP-2133 graduation** (doubts.md §6). Status:
  `open`/`planned`, decision is to **wait** until the `report_observation`
  handler and the resource shape have shipped in ≥ 2 published
  `@adaptivemcp/extension` releases with no breaking wire-schema changes, and
  at least one external consumer (or 4–6 weeks of real usage) exists — only
  then open the PR to `modelcontextprotocol/typescript-sdk`. Drafting the
  module skeleton now is fine; opening the PR early is not, since the SEP
  can't graduate Final without it.
- **Server Card #1649 dual-emit** (doubts.md §10/§11). The chosen hybrid
  precedence strategy (host UI > suggestion > nothing) is implemented, but the
  dual-emit of static risk once #1649 lands is blocked on that upstream issue
  shipping — nothing to do here until #1649 moves out of Draft.

## Phase 7: Distributed Execution Graph (complete)

Treats every tool invocation as a node in a directed acyclic graph (DAG),
turning telemetry into execution intelligence: critical path, bottlenecks,
failure cascades, cost-per-workflow, causal root-cause analysis, anti-pattern
detection, workflow forecasting, and MCP protocol support (paginated
resource, subscribe/notify) for exposing the graph. (Absorbed from the
now-retired `docs/EXECUTION_GRAPH_ROADMAP.md`, which tracked this work across
its own phases 4-12 before being folded in here.)

- `@adaptivemcp/spec`: `ExecutionNode` + graph analysis types; canonical
  `ExecutionGraphResource` wire schema and `buildExecutionGraph` builder.
- `@adaptivemcp/memory`: `execution_nodes` table with WAL mode, a versioned
  migration framework, and TTL-based pruning (`pruneExecutionNodes`).
- `@adaptivemcp/telemetry`: `startWorkflow`/`startChild`/`completeNode`/`failNode`
  auto-link parent/child nodes.
- `@adaptivemcp/graph-analysis` (new package): `GraphAnalyzer` — critical
  path, bottlenecks, fan-out, failure cascades, cost breakdown, workflow
  stats, causal cascade (root cause vs. symptom), anti-pattern detection
  (sequential bottleneck, diamond dependency), workflow forecasting, pattern
  and anomaly detection. `IncrementalGraphAnalyzer` caches reads for
  long-running/repeatedly-polled workflows.
- `@adaptivemcp/evaluation`: cross-session pattern learning
  (`evaluateAllWorkflows` aggregates `commonPatterns` across a workflow's runs).
- `@adaptivemcp/extension`: execution-graph/workflow-graph/graph-insights MCP
  resources with real content-hash ETags, pagination, and Mermaid + GraphViz
  DOT diagram export.
- `@adaptivemcp/thin-client`: `GraphTrackingMiddleware` (`AsyncLocalStorage`-based,
  concurrency-safe under parallel calls) auto-builds the graph and generates a
  W3C `traceparent` per node.
- `@adaptivemcp/routing`: `routeByPosition` — model selection based on a
  node's critical-path/leaf position within one specific execution.
- `examples`: four scenarios (`execution-graph`, `failure-cascade`,
  `cost-optimization`, `debugging-deployment`) plus a real MCP client/server
  demo of resource pagination and subscribe/notify over stdio.
- `adaptivemcp.github.io` (sibling repo): an interactive execution-graph
  explorer page (static Mermaid diagram + a D3-powered force-directed view).

**Descoped honestly, not silently:** "connection pooling" doesn't apply to
`node:sqlite`'s single-connection driver (WAL mode was implemented instead);
causal-cascade analysis is ancestor-based ordering, not counterfactual
replay; workflow forecasting is historical-baseline extrapolation, not a
trained model (this codebase has no ML/statistics dependencies anywhere);
anti-pattern detection covers two named shapes, not general subgraph
isomorphism (NP-hard); distributed tracing generates valid W3C trace context
as graph *data* since no live MCP transport exists in this codebase to carry
headers on; multi-server graph "federation" means a shared schema + builder,
not an implemented cross-server aggregation/discovery protocol.

**Validated by:** the full test suite (146 tests across all packages), all
four example scenarios, and a real stdio MCP client/server run exercising
resource pagination and subscribe/notify end-to-end.

## Phase 8: Decoding Policy (intent-aware sampling, backend-agnostic)

Generalizes the model-routing precedent (`@adaptivemcp/routing`'s `Router`,
Phase 2 — pick *which model* from observed stats) to *how the model decodes*.
Originated from a 2026-07-28 design conversation about correlating telemetry
with LLM sampling parameters (temperature/top_p/top_k/presence_penalty/
repetition_penalty) for a client/harness that owns both `ThinClient` and its
own completion call.

**Interim v0, shipped 2026-07-28 (now superseded by 8a-8c below):**
`SamplingAdvisor` (`packages/routing/src/sampling-advisor.ts`) emits a
`type: "sampling"` `Recommendation` with a raw `SamplingRecommendationPayload`
(`temperature`/`topP`) computed directly from `ToolStats.failureRate`,
delivered via `ThinClient`'s `samplingAdvisor`/`onSamplingRecommendation` hook
(`packages/thin-client/src/loop.ts`) and surfaced in `tools-metadata.yaml`
(`packages/extension/src/view.ts`). This conflates two concerns Phase 8 splits
apart: *which behavior is wanted* (backend-agnostic) vs. *which knobs express
that behavior on a specific backend* (backend-specific) — see 8a/8b.

**Explicit non-goal:** intent (e.g. "architecture review") is a
**caller-supplied hint**, never automatically classified from free text. This
codebase has no ML/statistics dependencies anywhere (Phase 7, "descoped
honestly") — a text classifier for intent would be the first one. Automatic
intent classification, if ever wanted, is a separate, explicitly-scoped
future effort — not an implicit part of 8a.

| # | Item | Level | Risk | Effort | Payoff |
| --- | --- | --- | --- | --- | --- |
| 8a | ✅ done — `DecodingAdvisor` replaces `SamplingAdvisor`; emits a symbolic `DecodingProfile`, not numbers | 1 | Low — same failure-rate heuristic, new output shape | Low — rename + payload change | Medium — unblocks 8b; no user-visible behavior change yet |
| 8b | ✅ done — `DecodingResolver`: static, table-driven `(profile, ModelCapabilities) -> ResolvedDecodingSettings` | 1 | Low — pure lookup logic, no learning | Low/Medium — new `ModelCapabilities` type + per-backend tables | High — the actual backend-agnostic payoff |
| 8c | ✅ done — `DecodingRecommendation` wrapper (`profile`, `resolved`, `resolverVersion`, `confidence`, `reasons[]`); deprecate (don't remove) `SamplingRecommendationPayload` | 1 | Medium — touches a payload shape external middleware may already depend on | Low/Medium — additive type + `@deprecated` tag | High — confidence/reasons let a host decide when to trust an override |
| 8f | ✅ done — Structured decision trace (intent → base profile → telemetry adjustment → resolved params → resolver version) | 1 | Low — presentational, no new data beyond 8a-8c | Low/Medium — richer `reasons[]`, or a trace object if that proves insufficient | Medium/High — the explainability feature that differentiates this from "middleware silently changed your temperature" |
| 8d | Extend `ToolExecutionEvent` with optional `decoding: {profile, resolverVersion, resolved}` | 2 | Medium — schema addition (additive/optional, no migration) | Low — mirrors existing optional fields (`model`, `metadata`) | Medium — enables 8e; makes past decisions reproducible even after resolver tables change |
| 8e | Decoding analyzer: cross-execution report grouped by (tool, profile, model) — retry rate, latency, suggested profile | 3 | Medium/High — first real analysis pass on brand-new data; needs 8d to have accumulated real telemetry first | Medium — mirrors `GraphAnalyzer`'s pure, computed-on-read shape | High — the "evidence, not auto-tuning" story |

Ordered by dependency, not strictly by risk/effort: 8a → 8b → 8c → 8f can ship
together (Level 1, no telemetry schema change); 8d (Level 2) unlocks 8e
(Level 3), which needs real accumulated data to be meaningful and is
naturally last.

**8a/8b/8c/8f shipped 2026-07-28** (Level 1, all together, per the dependency
note above). `SamplingAdvisor` and `SamplingRecommendationPayload` were kept
alongside (deprecated, not removed) exactly as decided — nothing that shipped
on 2026-07-28 (the v0 interim) was broken. 8d/8e remain unbuilt.

### 8a. `DecodingAdvisor` (replaces `SamplingAdvisor`) — ✅ done

- Rename `packages/routing/src/sampling-advisor.ts` → `decoding-advisor.ts`
  (`SamplingAdvisor` → `DecodingAdvisor`). Keeps the same `minInvocations`-gated
  shape as `Router`/`SamplingAdvisor` today.
- `advise()`/`adviseAll()` compute a `DecodingProfile` (`{ id: "deterministic" |
  "balanced" | "creative" }`) instead of raw `{temperature, topP}` — nothing
  backend-specific belongs in this package.
- **Composition, not replacement:** telemetry adjusts a profile, it doesn't
  originate one. An explicit caller-supplied `intentProfile` (e.g. "architecture
  review" → `balanced`) is the baseline; observed per-tool failure rate can pull
  the *effective* profile toward `deterministic` regardless of that baseline.
  This is the piece the v0 heuristic already had (failure rate → stricter
  sampling) and must not get lost when intent is introduced.
- New `RecommendationType` member `"decoding"` (keep `"sampling"` too, for one
  release — see 8c).
- **Shipped as designed**, with one refinement: a moderate failure rate also
  tempers a `creative` baseline down to `balanced` (not just the high-failure
  → `deterministic` override), so there's a two-tier response instead of an
  all-or-nothing one. Tests: `packages/routing/src/decoding-advisor.test.ts`.

### 8b. `DecodingResolver` — ✅ done

- New `ModelCapabilities` type — which sampler knobs a given backend/model
  actually exposes: `{ supports: { temperature?, topP?, topK?, minP?,
  presencePenalty?, repetitionPenalty?, frequencyPenalty? } }`.
- New `DecodingResolver.resolve(profile: DecodingProfile, capabilities:
  ModelCapabilities): ResolvedDecodingSettings`. Deliberately dumb: fallback
  rules, backend quirks, default values, table-driven — no learning, no
  telemetry access at all.
- Ship at least two backend tables at once (e.g. an OpenAI-style backend with
  only `temperature`/`topP`, and a llama.cpp-style backend with `temperature`/
  `topK`/`minP`) so the fallback logic is exercised by more than one shape from
  the start, instead of being designed against a single backend and guessed
  for the rest.
- **Shipped as designed** (`packages/routing/src/decoding-resolver.ts`) with
  three capability presets (`OPENAI_CAPABILITIES`, `LLAMA_CPP_CAPABILITIES`,
  `VLLM_CAPABILITIES`) and a versioned `DECODING_RESOLVER_VERSION` constant.
  The "fallback rule" is deliberately just "drop knobs the backend doesn't
  support" — no cross-knob approximation (`minP` is never substituted for
  `topP`; they aren't equivalent), tested explicitly in
  `packages/routing/src/decoding-resolver.test.ts`.

### 8c. `DecodingRecommendation` + deprecating `SamplingRecommendationPayload` — ✅ done

- `DecodingRecommendation { profile: DecodingProfile; resolved:
  ResolvedDecodingSettings; resolverVersion: string; confidence: number;
  reasons: string[] }` — what `DecodingAdvisor` + `DecodingResolver` jointly
  produce, replacing the bare payload as the unit a host consumes. **Note:**
  `resolved` uses the new `ResolvedDecodingSettings` type (`packages/spec/src/
  types.ts`), not `SamplingRecommendationPayload` as originally sketched in
  doubts.md §13 — the deprecated type is missing `minP`/`frequencyPenalty`,
  which the resolver needs to actually emit for non-OpenAI-style backends.
  `ResolvedDecodingSettings` is a strict superset with the same field names,
  so nothing that read `temperature`/`topP` off the old shape breaks.
- **Deprecate, don't migrate** `SamplingRecommendationPayload`
  (`packages/spec/src/types.ts`): mark it `@deprecated` in its doc comment,
  keep it exported and working as-is. It's already a shipped public shape
  (2026-07-28) — breaking published middleware that already depends on it for
  a rename gains little. Remove only at the next major version (`SPEC_VERSION`
  bump).
- `confidence`/`reasons[]` let a host apply an explicit override policy (e.g.
  "only auto-apply above 0.9, otherwise leave the user's config alone") instead
  of the advisor's word being final — consistent with the "advisory only,
  never enforced" precedent everywhere else in this codebase (`Router`'s model
  recommendations, the sampling hook itself).
- **Shipped as designed**, plus a small composer function,
  `toDecodingRecommendation(rec, resolver, capabilities)`
  (`packages/routing/src/decoding-resolver.ts`), since `DecodingAdvisor` and
  `DecodingResolver` deliberately don't know about each other (D1) — something
  has to combine their outputs into the full `DecodingRecommendation`, and it
  isn't either class's job.

### 8d. Extend telemetry with `decoding`

- Add optional `decoding?: { profile: DecodingProfile["id"]; resolverVersion:
  string; resolved: ResolvedDecodingSettings }` to `ToolExecutionEvent`
  (`packages/spec/src/types.ts`) — additive, no migration, same pattern as the
  existing optional `model`/`metadata` fields.
- Recording the *resolved* values (not just the profile id) is what keeps old
  events reproducible after the resolver's tables change — the core reason
  this is a distinct field rather than reusing `metadata`.
- `resolverVersion` needs an actual version string to bump — simplest is a
  hardcoded constant alongside the resolver's static tables (mirrors
  `SPEC_VERSION`'s pattern in `packages/spec/src/version.ts`), bumped by hand
  whenever 8b's tables change.

### 8e. Decoding analyzer

- New pass, likely in `@adaptivemcp/evaluation` or a small new module — reads
  accumulated `decoding` telemetry across many events for the same
  (tool, profile, model) tuple, unlike `evaluateRecord()`'s per-tool aggregate.
- Pure, computed-on-read, like `GraphAnalyzer` — **not** persisted as a
  `Recommendation`. This is a diagnostic report a developer reads (retry rate /
  avg latency / avg tokens per grouping, plus a suggested-profile line), never
  a state written back into a tool's record or auto-applied.
- Needs real accumulated 8d telemetry to be meaningful — naturally the last
  item in this phase.

### 8f. Structured decision trace — ✅ done

- Extend the "why" from a single `rationale: string` (today's shape, e.g.
  `SamplingAdvisor`'s `"high observed failure rate (0.20) — lower
  temperature/top_p..."`) into a trace with distinct stages: intent's base
  profile, the telemetry adjustment (if any) and its reason, the resolver's
  backend + resolved output, and the resolver version.
- Start with 8c's `reasons: string[]` (already human-readable) and only add a
  dedicated `trace` object if that proves insufficient for a real UI — avoid
  building a bespoke trace schema speculatively before there's a consumer that
  needs it.
- **Shipped as the `reasons[]` array only** (no separate `trace` object yet,
  per the "start simple" note above): `DecodingAdvisor` records each
  composition step (`"intent baseline: X"`, then an override/temper reason if
  telemetry changed it) as a separate string, and
  `toDecodingRecommendation`/`Recommendation.rationale.split("; ")` turns that
  back into `DecodingRecommendation.reasons`. See
  `examples/src/scenarios/decoding-policy.ts` for the full trace printed
  end-to-end across two backends.

### Deliberately not scheduled: `ExecutionPolicy` generalization

Generalizing `DecodingProfile` into a full `ExecutionPolicy` (`ContextProfile`,
`ToolSelectionProfile`, `RetryProfile`, `TimeoutProfile`, `MemoryProfile`,
`CostProfile`) was discussed and explicitly deferred (2026-07-28): several of
these already exist as independent, working mechanisms (`RetryPolicy`/
`Orchestrator` off failure rate, `BudgetPolicy`/`Router` off cost), each
already wired into `ThinClient` its own way. Wrapping them in a shared
abstraction now would buy naming symmetry with no behavior change, before even
8a-8f exist for decoding alone. Revisit only if/when a second real profile type
(e.g. `ContextProfile`) is actually being built, so the shared shape is
inferred from two real cases instead of guessed upfront.

