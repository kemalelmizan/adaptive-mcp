# Adaptive MCP — Examples & Walkthrough

This package is a **runnable tour** of the Adaptive MCP packages. It shows how to
stand up an MCP server and client, register tools, and attach the Adaptive MCP
extension so that a `tools-metadata.yaml` view is derived automatically from a
SQLite single source of truth (SSOT).

> **Mental model**
>
> ```text
> Tool execution (MCP server)
>         │
>         ▼
> Telemetry  ──records event──▶  MemoryStore (SQLite SSOT)
>         │                            │
>         │                            ▼
>         │                     Evaluation  ──insights──▶  MemoryStore
>         │                            │
>         ▼                            ▼
> ExtensionController  ◀──  reads SSOT  ──▶  tools-metadata.yaml (view)
>         │
>         ▼
> MCP resource: adaptive://tools-metadata.yaml
> ```
>
> The YAML is a **derived projection** of the SQLite store. Nobody edits it by
> hand — Adaptive MCP recomputes it whenever metadata changes.

## Prerequisites

- **Node 26** (the built-in `node:sqlite` module is used; it requires the
  `--experimental-sqlite` flag). No LTS, no other `fnm` versions.
- **pnpm 11.14.0** (latest in this registry).

```bash
eval "$(fnm env)" && fnm use 26
pnpm install
pnpm -r run build
```

All run commands below use `node --experimental-sqlite`. From the repo root:

```bash
cd examples
```

---

## Walkthrough 1 — A minimal MCP server with the Adaptive extension

The server below exposes two application tools (`deploy_service`,
`search_customer`) and one Adaptive MCP **resource** (`adaptive://tools-metadata.yaml`).
The server stays stateless and lightweight; all adaptive behavior lives in the
`AdaptiveRuntime` middleware.

```ts
// examples/src/server.ts (abridged)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AdaptiveRuntime } from "./runtime.js";

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
      // ← The only Adaptive MCP line: record the execution into the SSOT.
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

  // The Adaptive MCP resource: a derived YAML view of the SSOT.
  server.registerResource(
    "tools-metadata",
    "adaptive://tools-metadata.yaml",
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
ADAPTIVE_YAML=tools-metadata.yaml node --experimental-sqlite dist/server.js
```

**What this highlights**

- `@adaptivemcp/extension` — `ExtensionController.resourceText()` renders the YAML
  view; `resourceUri()` returns the stable `adaptive://tools-metadata.yaml` URI.
- `@adaptivemcp/spec` — the `adaptive://` extension namespace (`EXTENSIONS.toolsMetadata`).

---

## Walkthrough 2 — An MCP client that reads the derived view

The client connects over stdio, calls the tools, and reads the
`adaptive://tools-metadata.yaml` resource. The YAML it receives is computed from
the server's SQLite SSOT — the client never writes metadata.

```ts
// examples/src/client.ts (abridged)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { AdaptiveRuntime } from "./runtime.js";

export async function runClient() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--experimental-sqlite", new URL("./server.js", import.meta.url).pathname],
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

  const res = await client.readResource({ uri: "adaptive://tools-metadata.yaml" });
  const text = (res.contents[0] as { text: string }).text;
  console.log("\n--- tools-metadata.yaml (from server resource) ---\n");
  console.log(text);

  await client.close();
}
```

Run it:

```bash
node --experimental-sqlite -e "import('./dist/client.js').then(m => m.runClient())"
```

You'll see the server's tools listed and a YAML document printed — the live,
derived view of the SSOT after a handful of calls.

---

## Walkthrough 3 — The adaptation loop, locally

`AdaptiveRuntime` wires the packages together so you can watch the loop without
spawning a server:

```ts
// examples/src/runtime.ts (abridged)
export class AdaptiveRuntime {
  readonly memory: MemoryStore;          // @adaptivemcp/memory  — SQLite SSOT
  readonly telemetry: TelemetryRecorder; // @adaptivemcp/telemetry
  readonly evaluator: Evaluator;         // @adaptivemcp/evaluation
  readonly extension: ExtensionController;// @adaptivemcp/extension

  observeCompleted(input) {
    this.telemetry.complete(/* … */);    // event → MemoryStore (SSOT)
    this.evaluator.evaluateAll();        // SSOT stats → insights → SSOT
    this.extension.sync();               // SSOT → tools-metadata.yaml
  }
}
```

Run the local loop:

```bash
node --experimental-sqlite dist/client.js
```

---

## Scenarios

Each scenario is a small, focused demo of one or two packages. They write their
own `tools-metadata.*.yaml` next to them so you can diff the view across phases.

| Script | Packages highlighted | What it shows |
| --- | --- | --- |
| `node --experimental-sqlite dist/scenario.js` | spec · memory · telemetry · evaluation · extension | **Improvement over time**: a tool goes healthy → flaky → fixed; the YAML view evolves automatically. |
| `node --experimental-sqlite dist/scenarios/ssot.js` | spec · memory · extension | The SQLite store is the SSOT; the YAML is a pure projection. Writes metadata directly to the store. |
| `node --experimental-sqlite dist/scenarios/insights.js` | telemetry · evaluation · extension | Telemetry folds events into the SSOT; evaluation emits `observed_failure_rate` / `avg_duration_ms` insights as sample size grows. |
| `node --experimental-sqlite dist/scenarios/annotation.js` | spec · extension | Human `Annotation` (static) vs. learned `Insight` (dynamic) live side by side; only insights move on their own. |

Run them all:

```bash
node --experimental-sqlite dist/scenario.js
node --experimental-sqlite dist/scenarios/ssot.js
node --experimental-sqlite dist/scenarios/insights.js
node --experimental-sqlite dist/scenarios/annotation.js
```

### Sample YAML views

Committed, hand-annotated examples of the derived view live in [`yaml/`](./yaml):

- [`yaml/healthy.yaml`](./yaml/healthy.yaml) — reliable tool with a human annotation.
- [`yaml/flaky.yaml`](./yaml/flaky.yaml) — regression detected; `observed_failure_rate` insight appears.
- [`yaml/annotated.yaml`](./yaml/annotated.yaml) — full shape including a `recommendations` entry.

These mirror what the scenarios print. Use them to see the schema at a glance.

---

## Package map

| Package | Role in the examples |
| --- | --- |
| `@adaptivemcp/spec` | Shared types (`ToolRecord`, `Annotation`, `Insight`, `Recommendation`, `ToolStats`) and the `adaptive://` extension namespace. |
| `@adaptivemcp/memory` | `MemoryStore` over `node:sqlite` — the SSOT. `setAnnotation` / `addInsight` / `addRecommendation` / `recordExecution`. |
| `@adaptivemcp/telemetry` | `TelemetryRecorder` + `MemoryBackedTelemetryStore` fold every execution event into the SSOT. |
| `@adaptivemcp/evaluation` | `Evaluator` reads SSOT stats and writes derived `Insight`s once a confidence threshold is met. |
| `@adaptivemcp/extension` | `ExtensionController` renders the SSOT to `tools-metadata.yaml` and exposes it as an MCP resource. |

> `routing`, `orchestration`, `approval`, and `thin-client` are intentional stubs
> in this first implementation and are not exercised by the examples yet.
