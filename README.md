# Adaptive MCP

Adaptive MCP is a runtime ecosystem that learns behavior around MCP primitives.
It does **not** replace MCP, redefine tools, or introduce new protocol
abstractions. Instead it observes how tools are used, attaches metadata to
existing MCP primitives, and helps runtimes adapt over time.

> MCP standardizes capabilities. Adaptive MCP learns behavior.

## Design constraints

- **MCP standardizes capabilities; Adaptive MCP learns behavior.** The system
  answers *"what have we learned about how models and humans use those
  capabilities?"* — not *"what can the model do?"*.
- **Enrich, don't replace.** No first-class `adaptiveTool`, `adaptiveSkill`,
  `adaptiveIntent`, or `adaptiveWorkflow` concepts. Adaptive MCP operates on MCP
  primitives (tools, resources) as intentional boundaries.
- **Avoid coupling to implementation details.** Packages must not depend on
  shell, filesystem paths, processes, sockets, or HTTP as first-class concepts.
  Those remain implementation details of the host.
- **Middleware is operational machinery.** Telemetry, evaluation, memory,
  routing, and approval exist to observe, evaluate, remember, route, and
  recommend. Business logic belongs in middleware packages; the client stays
  thin.
- **Stateless servers, accumulating clients.** MCP servers are lightweight and
  replaceable. Clients accumulate knowledge in a local source of truth.

## Architecture

The adaptation loop runs entirely on the client/runtime side:

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
ExtensionController  ◀──  reads SSOT  ──▶  tools-metadata.yaml (derived view)
        │
        ▼
MCP resource: dev.adaptivemcp/tools-metadata
```

Data always flows in one direction: **event → MemoryStore (SSOT) → derived
YAML view**. The YAML is never edited directly; it is recomputed from the SSOT
whenever metadata changes.

## Data model

All metadata is persisted in a SQLite store (`node:sqlite`). The schema is a
single `tools` table keyed by `tool_name`:

| Column | Type | Contents |
| --- | --- | --- |
| `tool_name` | TEXT (PK) | Tool identifier |
| `server_name` | TEXT | Originating MCP server |
| `annotation` | JSON | Static, human-written `Annotation` |
| `insights` | JSON | Learned `Insight[]` |
| `recommendations` | JSON | Suggested `Recommendation[]` |
| `stats` | JSON | Accumulated `ToolStats` |
| `updated_at` | TEXT | ISO-8601 timestamp |

### Core types (`@adaptivemcp/spec`)

- **`Annotation`** — static, human-authored metadata: `risk`, `owner`, `tags`,
  `description`. Never changes on its own.
- **`Insight`** — learned from observed behavior: `key`, `value`, `confidence`,
  `source` (`evaluation` | `telemetry`), `sampleSize`. Upserted by key.
- **`Recommendation`** — suggested adaptation: `type`
  (`model` | `approval` | `workflow` | `routing`), `payload`, `rationale`,
  `confidence`. Written by the routing/orchestration/approval packages.
- **`ToolStats`** — `invocations`, `failures`, `failureRate`, `avgDurationMs`,
  `totalCost`, `lastObservedAt`. Folded from each execution event.
- **`ToolRecord`** — the aggregate row: `toolName`, `serverName`, `annotation`,
  `insights`, `recommendations`, `stats`, `updatedAt`.

### Derived YAML view (`tools-metadata.yaml`)

The `ExtensionController` projects each `ToolRecord` into a `ToolMetadataView`
and serializes the document with `js-yaml`. The view is the machine- and
human-readable projection consumed by out-of-band MCP clients.

## Packages

| Package | Responsibility |
| --- | --- |
| `@adaptivemcp/spec` | Extension identifiers (SEP-2133 `dev.adaptivemcp/` namespace), event schemas, shared types |
| `@adaptivemcp/memory` | SQLite SSOT store (`MemoryStore`) over `node:sqlite` |
| `@adaptivemcp/telemetry` | `TelemetryRecorder` + memory-backed store + stat queries |
| `@adaptivemcp/evaluation` | `Evaluator` emits `observed_failure_rate` / `avg_duration_ms` insights |
| `@adaptivemcp/extension` | `ExtensionController` derives + writes the YAML view and exposes the MCP resource |
| `@adaptivemcp/routing` | `Router` — model selection + budget guardrails |
| `@adaptivemcp/orchestration` | `Orchestrator` — retry-policy (`workflow`) recommendations |
| `@adaptivemcp/approval` | `ApprovalGate` — enforcement (allow / deny / require_confirmation) |
| `@adaptivemcp/thin-client` | `ThinClient` — client-side execution loop with gate + retry |

### Adaptation behaviors

- **Routing** (`Router.routeTool`): picks the cheapest model meeting the
  observed latency/failure profile; emits a `routing` recommendation when a
  tool/server approaches or exceeds its cost budget (≥ 80% of limit).
- **Orchestration** (`Orchestrator.planTool`): when `failureRate ≥
  flakyThreshold` (default 0.1), writes a `workflow` recommendation with a retry
  policy scaled to the failure rate (capped at `maxAttempts = 6`).
- **Approval** (`ApprovalGate.gate`): returns `deny` for denied tools,
  `require_confirmation` for high-risk annotations or flaky tools (failure rate
  ≥ `flakyFailureRate`, default 0.2, after `minInvocations`), else `allow`.
  Writes an `approval` recommendation with `payload: { decision }`.
- **Thin client** (`ThinClient.run`): consults the gate, then executes with the
  SSOT-derived retry policy (or default). Records the outcome back to the SSOT.

## MCP extension spec integration (SEP-2133)

MCP formalizes the **server** contract and lets the server **govern** how clients
interact with its primitives — the same direction as the **Prompts** primitive
(server authors, client discovers & applies). Adaptive MCP adopts that pattern:
the server **governs** tool adaptation by publishing policy, and the client is
the **executor** that learns dynamically and reports observations back.

Adaptive MCP proposes a **narrow, server-governed** extension — a single resource
the server publishes so clients can read (and report against) learned tool
metadata. The proposal (draft) lives at
[`docs/sep-2133-tools-metadata.md`](./docs/sep-2133-tools-metadata.md).

| Field | Value |
| --- | --- |
| URI | `dev.adaptivemcp/tools-metadata` |
| MIME type | `application/yaml` |
| Scope | server governance (annotations, budgets, required approvals) + client-reported observations |

The `dev.adaptivemcp/` prefix is the reversed domain of `adaptivemcp.dev` (owned
by the author), satisfying SEP-2133's namespace rule. The client learning
machinery (`@adaptivemcp/telemetry`, `evaluation`, `routing`, `orchestration`,
`approval`, `thin-client`) is the **executor** of this policy, not part of the
extension's server contract.

The derived YAML view is exposed as the MCP resource
`dev.adaptivemcp/tools-metadata` (mime type `application/yaml`).

### Advertising the extension in `initialize`

The `@modelcontextprotocol/sdk` (v1.29) does **not** yet implement the
`extensions` capability map, so the identifier cannot currently be advertised
through the SDK's `initialize` capabilities. Until it does, Adaptive MCP
degrades gracefully:

- the resource is registered directly via `server.registerResource(...)`;
- the `EXTENSION_NAMESPACE` / `TOOLS_METADATA_EXTENSION` constants in
  `@adaptivemcp/spec` provide the canonical identifier for any host that wants to
  advertise it once the SDK supports `capabilities.extensions`.

When the SDK supports it, a server would advertise:

```ts
// conceptual — pending SDK support for capabilities.extensions
const server = new McpServer({ name: "adaptive-example", version: "0.1.0" });
server.registerResource("tools-metadata", "dev.adaptivemcp/tools-metadata", {
  title: "Adaptive MCP Tools Metadata",
  mimeType: "application/yaml",
}, async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/yaml", text: runtime.extension.resourceText() }] }));
// and, once supported, advertise in initialize:
// capabilities: { extensions: { "dev.adaptivemcp/tools-metadata": {} } }
```

## How to build, test, and run

Requires **Node 26** (the `node:sqlite` module is stable; no flag required)
and **pnpm 11.14.0**.

```bash
pnpm install
pnpm -r run build      # compile all packages + examples
pnpm test              # run the Vitest suite (unit + integration)
pnpm lint              # ESLint
```

### Scenarios (`examples`)

```bash
cd examples
node dist/scenario.js          # improvement over time (healthy → flaky → fixed)
node dist/scenarios/ssot.js     # SSOT is the source of truth; YAML is derived
node dist/scenarios/insights.js # telemetry → evaluation → insights
node dist/scenarios/annotation.js # human annotation vs. learned insight
node dist/scenarios/adaptive.js   # full stack: routing + orchestration + approval + thin-client
```

### MCP server + client

```bash
node dist/server.js   # registers deploy_service, search_customer, and the tools-metadata resource
node dist/client.js    # local loop that reads dev.adaptivemcp/tools-metadata
```

## Testing

The suite (`vitest`) covers every package plus an end-to-end integration test:

- **Unit** — `memory` (SSOT folding), `evaluation` (insight thresholds),
  `extension` (view projection + YAML stability), `routing` (model + budget),
  `orchestration` (retry scaling), `approval` (gate decisions), `thin-client`
  (gate + retry execution).
- **Integration** — `examples/src/runtime.test.ts` drives `AdaptiveRuntime`
  through `observeCompleted` and asserts the derived SSOT state, the
  recommendation types, the approval gate decision, and YAML stability/disk
  write.

`node:sqlite` is loaded via a Vitest alias shim (`vitest.sqlite-shim.mjs`)
because Vite 5.x does not recognize the builtin as external; at runtime Node 26
resolves it natively.

## Repository layout

```text
adaptive-mcp/
├── packages/      # @adaptivemcp/* library packages
├── examples/      # runnable server, client, and scenarios
├── apps/          # docs / playground (scaffolds)
├── docs/          # PLAN.md implementation plan
├── scripts/
├── vitest.config.ts
├── vitest.sqlite-shim.mjs
├── AGENTS.md
└── README.md
```

## Status

All planned packages are implemented and wired into `AdaptiveRuntime`. The
`examples` scenarios validate the full adaptation loop end to end. See
`docs/PLAN.md` for the phased status and `examples/README.md` for the scenario
walkthrough.
