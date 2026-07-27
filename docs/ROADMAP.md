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

> Two follow-ups from this phase are still open and tracked in Phase 6: the
> reference impl doesn't yet emit `budget`/`require_approval` (6f), and
> graduating the SEP to Final is blocked on an upstream SDK PR (see
> "Blocked / external dependency" at the end of Phase 6).

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

| # | Item | Risk | Effort | Payoff |
| --- | --- | --- | --- | --- |
| 6a | Pattern matching in `ApprovalPolicy` | Low — isolated to `approval`, precedence order unchanged | Low — matcher + tests | Medium — ergonomic, immediate |
| 6b | Context-cost tracked dimension | Low — additive field, no external dependency | Low — extend fold + threshold insight | Medium — unlocks a recommendation type, but needs a real token/byte source to be useful |
| 6c | More insight types: cost drift, latency regression, approval friction | Low — additive, same shape as existing insights | Low/Medium — one evaluator pass per insight | Medium — broadens what the YAML surfaces, no new package |
| 6d | `repetition_detected` insight | Low — self-contained in `evaluation`, no schema break | Medium — sequence detection is new logic, not a fold-in-place stat | Medium/High — new capability, feeds `ApprovalGate` |
| 6e | Conformance scenarios (graceful degradation) | Low — test-only, no production code changes | Medium — need scenarios simulating hosts that ignore the extension | Medium — confidence/trust, not new capability |
| 6f | Emit `budget` / `require_approval` in the reference impl | Medium — touches the wire schema tracked for SEP graduation | Medium — extend `ExtensionController` view + `spec` types | High — unblocks the SEP stabilization gate (see Blocked list) |
| 6g | Multi-server aggregation (merge `tools-metadata` across servers) | Medium — key-collision handling across servers in `ExtensionController` | Medium/High | Medium/High — real multi-server hosts need this |
| 6h | Client OAuth delegation flow | Medium — credential handling is security-sensitive | Medium/High — the hook point exists (Phase 5); the flow itself doesn't | Medium — unblocks one integration, not the core loop |
| 6i | Host adapter (OpenCode plugin) | Medium — depends on OpenCode's hook signatures, only known from docs, not verified against real code | High — new package, needs real-world validation | High — proves the loop on a real, popular agent instead of only synthetic demos |
| 6j | Session-scoped telemetry | Medium/High — schema change threaded through `spec`/`telemetry`/`evaluation`; co-occurrence shape still TBD | High — design pass required before implementation | Medium — research-oriented (AGENTS.md open question), less immediately actionable; **depends on 6i** for real session boundaries |

### 6a. Pattern matching in `ApprovalPolicy`

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

- Design the merge/key-collision rule (recall the `(tool_name, server_name)`
  composite key already exists specifically because two servers can expose a
  same-named tool — the aggregation view needs to preserve that distinction,
  not flatten it).
- Likely lands as a new method on `ExtensionController` or a small aggregator
  that composes multiple `Store`s, rather than a new package.

### 6h. Client OAuth delegation flow

Phase 5 shipped the `beforeCall` credential-injection **hook point** for
middleware but deliberately deferred the actual OAuth flow ("design the hook
point now, specify the exact flow later" — doubts.md §12).

- Design and implement the flow itself: token acquisition, refresh, and
  storage for a middleware that needs to inject credentials into a tool call.
- Security-sensitive — this is the one item in Phase 6 that touches credential
  handling directly, hence the elevated risk grade despite reusing an existing
  hook point.

### 6i. Host adapter: prove the loop on a real harness

Everything so far is validated by `examples/` scenarios (synthetic telemetry),
never by a real agent host. OpenCode's plugin system already exposes the hook
shape Adaptive MCP's `@adaptivemcp/middleware` `Middleware` interface mirrors
(`beforeCall`/`afterCall` ≈ OpenCode's `tool.execute.before`/`tool.execute.after`),
loaded from `.opencode/plugins/` or an npm package.

- New package: `@adaptivemcp/opencode-plugin` — maps OpenCode's
  `tool.execute.before`/`tool.execute.after` hooks onto
  `TelemetryRecorder`/`MiddlewareChain`, and `session.*` hooks onto the
  session-tagging work in 6j.
- Follows the mcp-binary precedent: a thin, sanctioned adapter at the edge: no
  core package depends on it.
- Highest ceiling of any Phase 6 item — the difference between "library with
  good internal design" and something that learns from a real, popular agent
  instead of only local demos — but graded medium/high risk+effort here because
  it is the only item resting on an external API only seen through docs, not
  verified against OpenCode's actual source.

### 6j. Session-scoped telemetry

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

