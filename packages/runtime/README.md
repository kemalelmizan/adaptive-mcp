# @adaptivemcp/runtime

Batteries-included Adaptive MCP runtime: wires telemetry, evaluation, routing,
orchestration, approval, middleware, and the extension view into one
transport-agnostic loop.

This is the fastest way to get the full adaptation loop — observe, evaluate,
remember, route, recommend — without wiring the individual packages by hand.
It owns the loop but not the MCP transport: pair it with the official SDK or
`@adaptivemcp/thin-client` to actually execute tool calls.

## Install

```bash
npm i @adaptivemcp/runtime
```

Requires **Node 22+** (Node 26 recommended).

## Usage

```ts
import { AdaptiveRuntime } from "@adaptivemcp/runtime";

const runtime = new AdaptiveRuntime({ yamlPath: "tools-metadata.yaml" });

// After a tool call completes:
runtime.observeCompleted({
  toolName: "search_docs",
  serverName: "docs-server",
  durationMs: 420,
  status: "completed",
  output: { results: 3 },
});

// Heavier, cross-tool passes are invoked explicitly once enough signal exists:
runtime.router.routeAll();
runtime.orchestrator.planAll();

// Enforcement hook before a planned call runs:
const decision = runtime.gate("search_docs", "docs-server");

runtime.close();
```

## Execution graphs

Pass `enableGraph: true` (with the default `MemoryStore` backing) to track a
workflow as a DAG of nodes:

```ts
const runtime = new AdaptiveRuntime({ enableGraph: true });

const { nodeId: rootId, sessionId } = runtime.startWorkflow({ toolName: "deploy" });
const { nodeId: childId } = runtime.startChild({ toolName: "run_tests" }, rootId);
runtime.completeNode(childId, { durationMs: 1200 });
runtime.completeNode(rootId, { durationMs: 5000 });
```

For deeper graph analysis (critical path, bottlenecks, cost breakdowns,
anomaly detection), pair the resulting `sessionId`s with
`@adaptivemcp/graph-analysis`'s `GraphAnalyzer` directly against
`runtime.memory`.

## Middleware

```ts
runtime.use({
  async afterCall(result) {
    console.log("tool returned", result);
  },
});
```

Registered middleware run around `observeCompleted`'s YAML sync via
`MiddlewareChain`; see `@adaptivemcp/middleware` for the full hook contract.

## API

| Member | Purpose |
| --- | --- |
| `memory` | The backing `Store` (defaults to an in-memory `MemoryStore`). |
| `telemetry` | `TelemetryRecorder` — records tool execution events. |
| `evaluator` | `Evaluator` — derives insights from telemetry. |
| `router` | `Router` — model/routing recommendations. |
| `orchestrator` | `Orchestrator` — composition/retry recommendations. |
| `approval` | `ApprovalGate` — enforcement decisions. |
| `extension` | `ExtensionController` — derives the YAML `tools-metadata` view. |
| `middleware` | `MiddlewareChain` — pluggable `beforeCall`/`afterCall`/`onError` hooks. |
| `use(mw)` | Register a middleware. Returns `this` for chaining. |
| `observeCompleted(input)` | Record a completed/failed call, evaluate, and re-sync the YAML view. |
| `startWorkflow`/`startChild`/`completeNode`/`failNode` | Execution-graph tracking (requires `enableGraph: true`). |
| `gate(toolName, serverName?)` | Enforcement hook: decide whether a planned call may proceed. |
| `close()` | Close the backing store. |

## License

Released under the [MIT License](../../LICENSE). Copyright (c) 2026 Kemal Elmizan.
