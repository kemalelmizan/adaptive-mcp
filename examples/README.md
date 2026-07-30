# Adaptive MCP: Examples and Walkthrough

This package is a **runnable tour** of the Adaptive MCP packages. It shows how to
stand up an MCP server and client, register tools, and attach the Adaptive MCP
extension so that a `tools-metadata.yaml` view is derived automatically from a
SQLite store.

> **Mental model**
>
> ```text
> Tool execution (MCP server)
>         │
>         ▼
> Telemetry  ──records event──▶  MemoryStore (SQLite)
>         │                            │
>         │                            ▼
>         │                     Evaluation  ──insights──▶  MemoryStore
>         │                            │
>         ▼                            ▼
> ExtensionController  ◀──  reads the store  ──▶  tools-metadata.yaml (view)
>         │
>         ▼
> MCP resource: dev.adaptivemcp/tools-metadata
> ```
>
> The YAML is a **derived projection** of the SQLite store. Nobody edits it by
> hand. Adaptive MCP recomputes it whenever metadata changes.

> **Server-side vs. client-side**
>
> It's tempting to assume `@adaptivemcp/extension` is "the server half" and
> `@adaptivemcp/runtime` is "the client half," since one sounds like a server
> plugin and the other sounds like a client runtime. That's not the split:
>
> - `@adaptivemcp/extension` **is** server-side: it derives `tools-metadata.yaml`
>   from the store and serves it as an MCP resource (Walkthrough 1).
> - `@adaptivemcp/runtime` (`AdaptiveRuntime`) is a **transport-agnostic bundle**
>   that wires telemetry, evaluation, routing, orchestration, approval, and the
>   extension together. In these examples it's used server-side (Walkthrough 1)
>   and standalone, with no server or client at all (Walkthrough 3). It is not
>   "the client."
> - The actual client-side package is `@adaptivemcp/thin-client` (`ThinClient`):
>   it owns the execution lifecycle on the client — consulting the approval
>   gate and applying the store-derived retry policy before calling a tool. See
>   `dist/scenarios/adaptive.js`.

## Prerequisites

- **Node 22+** (Node 26 recommended)
- **pnpm 11+**

```bash
pnpm install
pnpm -r run build
```

All run commands below use `node`. From the repo root:

```bash
cd examples
```

---

## Walkthrough 1: A minimal MCP server with the Adaptive extension

The server below exposes two application tools (`deploy_service`,
`search_customer`) and one Adaptive MCP **resource** (`dev.adaptivemcp/tools-metadata`).
The server stays stateless and lightweight; all adaptive behavior lives in the
`AdaptiveRuntime` middleware.

```ts
// examples/src/server.ts (abridged)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AdaptiveRuntime } from "@adaptivemcp/runtime";

export async function startServer(dbPath?: string, yamlPath?: string) {
  const runtime = new AdaptiveRuntime({ dbPath, yamlPath });
  const server = new McpServer({ name: "adaptive-example-server", version: "0.1.0" });

  server.registerTool(
    "deploy_service",
    {
      title: "Deploy Service",
      description: "Deploy a service to the target environment.",
      inputSchema: { environment: z.string(), version: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ environment, version }) => {
      const failed = Math.random() < 0.15;
      const durationMs = 800 + Math.floor(Math.random() * 1200);
      // ← The only Adaptive MCP line: record the execution into the store.
      runtime.observeCompleted({
        toolName: "deploy_service",
        serverName: "adaptive-example-server",
        durationMs,
        status: failed ? "failed" : "completed",
        model: "gpt-5-mini",
        cost: { amount: 0.0021, currency: "USD" },
        error: failed ? { message: "rollout timed out" } : undefined,
      });
      return {
        content: failed
          ? [{ type: "text", text: "deploy failed: rollout timed out" }]
          : [{ type: "text", text: `deployed ${version} to ${environment}` }],
        isError: failed,
      };
    },
  );

  // The Adaptive MCP resource: a derived YAML view of the store.
  server.registerResource(
    "tools-metadata",
    "dev.adaptivemcp/tools-metadata",
    { title: "Adaptive MCP Tools Metadata", mimeType: "application/yaml" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/yaml", text: runtime.extension.resourceText() }],
    }),
  );

  await server.connect(new StdioServerTransport());
  return server;
}
```

Run it (it blocks on stdio; the client in Walkthrough 2 drives it):

```bash
ADAPTIVE_YAML=tools-metadata.yaml node dist/server.js
```

**What this highlights**

- `@adaptivemcp/extension`: `ExtensionController.resourceText()` renders the YAML
  view; `resourceUri()` returns the stable `dev.adaptivemcp/tools-metadata` URI.
- `@adaptivemcp/spec`: the `dev.adaptivemcp/` namespace; `TOOLS_METADATA_EXTENSION` is the proposed extension resource identifier.

---

## Walkthrough 2: An MCP client that reads the derived view

The client connects over stdio, calls the tools, and reads the
`dev.adaptivemcp/tools-metadata` resource. The YAML it receives is computed from
the server's SQLite store. The client never writes metadata.

This walkthrough's client is deliberately "dumb": it doesn't consult any
Adaptive MCP package at all, just the plain MCP SDK. (`examples/src/client.ts`
also exports a `runLocalLoop()` that uses `AdaptiveRuntime` standalone — that's
Walkthrough 3, not this one, and it isn't "the client's" logic.) A client that
actually *acts* on the adaptive signal — gating on approval, retrying per the
learned policy — would drive its calls through `@adaptivemcp/thin-client`'s
`ThinClient` instead; see `dist/scenarios/adaptive.js`.

```ts
// examples/src/client.ts (abridged)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export async function runClient() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL("./server.js", import.meta.url).pathname],
    env: { ...process.env, ADAPTIVE_YAML: "tools-metadata.client.yaml" },
  });
  const client = new Client({ name: "adaptive-example-client", version: "0.1.0" });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log("Server tools:", tools.tools.map((t) => t.name).join(", "));

  for (let i = 0; i < 5; i++) {
    await client.callTool({ name: "search_customer", arguments: { customerId: `c-${i}` } });
  }
  await client.callTool({ name: "deploy_service", arguments: { environment: "prod", version: "1.0.0" } });

  const res = await client.readResource({ uri: "dev.adaptivemcp/tools-metadata" });
  const text = (res.contents[0] as { text: string }).text;
  console.log("\n--- tools-metadata.yaml (from server resource) ---\n");
  console.log(text);

  await client.close();
}
```

Run it:

```bash
node -e "import('./dist/client.js').then(m => m.runClient())"
```

You'll see the server's tools listed and a YAML document printed. This is the live,
derived view of the store after a handful of calls.

---

## Walkthrough 3: The adaptation loop, locally

`AdaptiveRuntime` (from `@adaptivemcp/runtime`) wires the packages together so
you can watch the loop without spawning a server. Its public surface is:

```ts
// @adaptivemcp/runtime — AdaptiveRuntime (abridged)
export class AdaptiveRuntime {
  readonly memory: Store;               // @adaptivemcp/memory: SQLite store
  readonly telemetry: TelemetryRecorder; // @adaptivemcp/telemetry
  readonly evaluator: Evaluator;         // @adaptivemcp/evaluation
  readonly extension: ExtensionController;// @adaptivemcp/extension
  readonly router: Router;               // @adaptivemcp/routing
  readonly orchestrator: Orchestrator;   // @adaptivemcp/orchestration
  readonly approval: ApprovalGate;       // @adaptivemcp/approval

  observeCompleted(input) {
    this.telemetry.complete(/* … */);    // event → MemoryStore
    this.evaluator.evaluateAll();        // store stats → insights → store
    this.extension.sync();               // store → tools-metadata.yaml
  }
  // Routing + orchestration are explicit passes you call once enough signal
  // has accumulated: router.routeAll(); orchestrator.planAll();
}
```

Run the local loop (the `quickstart` script drives it end to end):

```bash
pnpm quickstart
```

---

## Scenarios

Each scenario is a small, focused demo of one or two packages. They write their
own `tools-metadata.*.yaml` next to them so you can diff the view across phases.

| Script | Packages highlighted | What it shows |
| --- | --- | --- |
| `node dist/scenario.js` | spec · memory · telemetry · evaluation · extension | **Improvement over time**: a tool goes healthy → flaky → fixed; the YAML view evolves automatically. |
| `node dist/scenarios/store.js` | spec · memory · extension | The SQLite store is the store; the YAML is a pure projection. Writes metadata directly to the store. |
| `node dist/scenarios/insights.js` | telemetry · evaluation · extension | Telemetry folds events into the store; evaluation emits `observed_failure_rate` / `avg_duration_ms` insights as sample size grows. |
| `node dist/scenarios/annotation.js` | spec · extension | Human `Annotation` (static) vs. learned `Insight` (dynamic) live side by side; only insights move on their own. |
| `node dist/scenarios/adaptive.js` | routing · orchestration · approval · thin-client | **Full adaptive stack**: model selection + budget, retry policy for flaky tools, the approval gate enforcement hook, and the thin-client loop that consults both. |
| `node dist/scenarios/execution-graph.js` | spec · memory · graph-analysis · extension | **Execution graph intelligence**: builds a DAG from tool invocations; critical-path, bottleneck, and fan-out/fan-in analysis; failure cascades; per-workflow cost breakdown; workflow pattern detection. |
| `node dist/scenarios/failure-cascade.js` | graph-analysis · approval | **Failure cascade analysis**: simulates a failure partway through a deployment workflow graph and traces its blast radius, showing how approval recommendations trigger for upstream nodes. |
| `node dist/scenarios/middleware.js` | middleware · thin-client · mcp-binary | **Middleware plumbing**: explicit `use()` registration and hook ordering, `call.output` mutation, and the YAML `middleware` `contributeView` map — plus `HeadroomMiddleware` (context compression) and `createRtkWrapper` (wraps the [`rtk`](https://rtk-ai.app) CLI as an MCP server). |
| `node dist/scenarios/cost-optimization.js` | graph-analysis | **Cost attribution**: builds a CI/CD workflow with varying per-tool costs and breaks it down by tool, node, and critical path across multiple runs. |
| `node dist/scenarios/debugging-deployment.js` | graph-analysis | **Debugging a failed deployment**: causal cascade (root causes vs. symptoms across independent failure chains), anti-pattern detection, and workflow forecasting, with Mermaid/DOT diagram exports of the failed graph. |
| `node dist/scenarios/sampling-recommendations.js` | routing · thin-client | **Sampling-parameter recommendations**: turns observed failure rates into an advisory `temperature`/`top_p` recommendation that `ThinClient` reads back via `onSamplingRecommendation`. Advisory only — nothing here makes an LLM call. |
| `node dist/scenarios/decoding-policy.js` | routing | **Decoding policy**: `DecodingAdvisor` picks a backend-agnostic `DecodingProfile` from intent + observed failure rate; `DecodingResolver` separately translates it into concrete backend knobs (OpenAI vs. llama.cpp), composed only by `toDecodingRecommendation`. |

Run them all:

```bash
node dist/scenario.js
node dist/scenarios/store.js
node dist/scenarios/insights.js
node dist/scenarios/annotation.js
node dist/scenarios/adaptive.js
node dist/scenarios/execution-graph.js
node dist/scenarios/failure-cascade.js
node dist/scenarios/middleware.js
node dist/scenarios/cost-optimization.js
node dist/scenarios/debugging-deployment.js
node dist/scenarios/sampling-recommendations.js
node dist/scenarios/decoding-policy.js
```

### Sample YAML views

Committed, illustrative examples of the derived view live in [`yaml/`](./yaml):

- [`yaml/healthy.yaml`](./yaml/healthy.yaml): reliable tool with a human annotation.
- [`yaml/flaky.yaml`](./yaml/flaky.yaml): regression detected; `observed_failure_rate` insight appears.
- [`yaml/annotated.yaml`](./yaml/annotated.yaml): full shape including a `recommendations` entry.

These mirror what the scenarios print. Use them to see the schema at a glance.

---

## Package map

| Package | Role in the examples |
| --- | --- |
| `@adaptivemcp/spec` | Shared types (`ToolRecord`, `Annotation`, `Insight`, `Recommendation`, `ToolStats`) and the `dev.adaptivemcp/` extension namespace. |
| `@adaptivemcp/memory` | `MemoryStore` over `node:sqlite`, the store. `setAnnotation` / `addInsight` / `addRecommendation` / `recordExecution`. |
| `@adaptivemcp/telemetry` | `TelemetryRecorder` + `MemoryBackedTelemetryStore` fold every execution event into the store. |
| `@adaptivemcp/evaluation` | `Evaluator` reads store stats and writes derived `Insight`s once a confidence threshold is met. |
| `@adaptivemcp/extension` | `ExtensionController` renders the store to `tools-metadata.yaml` and exposes it as an MCP resource. |
| `@adaptivemcp/routing` | `Router` writes `model` (cheapest model meeting observed latency/failure) and `routing` (budget warning) recommendations into the store. |
| `@adaptivemcp/orchestration` | `Orchestrator` writes a `workflow` recommendation with a retry policy scaled to the observed failure rate. |
| `@adaptivemcp/approval` | `ApprovalGate` is the enforcement hook: `gate()` returns `allow` / `require_confirmation` / `deny` from the annotation risk + learned failure rate, and records an `approval` recommendation. |
| `@adaptivemcp/thin-client` | `ThinClient` runs the client-side loop: consults the approval gate, then executes with the store-derived retry policy. |
| `@adaptivemcp/graph-analysis` | `GraphAnalyzer` computes critical path, bottlenecks, fan-out/fan-in, failure cascades, anti-patterns, and cost breakdowns over the execution DAG. |
| `@adaptivemcp/middleware` | `MiddlewareChain` runs pluggable hooks (`beforeCall`/`afterCall`/`onError`/`contributeView`), including `HeadroomMiddleware` for context compression. |
| `@adaptivemcp/mcp-binary` | `createRtkWrapper` wraps an existing CLI binary (e.g. `rtk`) as an MCP server over stdio. |

> The four packages above are exercised by `dist/scenarios/adaptive.js`. The
> graph/middleware/binary packages are exercised by `dist/scenarios/execution-graph.js`,
> `dist/scenarios/failure-cascade.js`, `dist/scenarios/cost-optimization.js`,
> `dist/scenarios/debugging-deployment.js`, and `dist/scenarios/middleware.js`.
