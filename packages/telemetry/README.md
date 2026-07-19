# @adaptivemcp/telemetry

Tool execution events and observability for Adaptive MCP.

`telemetry` is the **observe** step of the adaptation loop. It captures
`ToolExecutionEvent`s — the atomic observations of tool executions — and folds
them into the SSOT (`@adaptivemcp/memory`).

## Install

```bash
npm i @adaptivemcp/telemetry
```

Requires **Node 26**.

## Usage

```ts
import { MemoryStore } from "@adaptivemcp/memory";
import { TelemetryRecorder, MemoryBackedTelemetryStore } from "@adaptivemcp/telemetry";

const store = new MemoryStore({ path: ":memory:" });
const recorder = new TelemetryRecorder({
  store: new MemoryBackedTelemetryStore(store),
});

const ctx = { toolName: "deploy_service", serverName: "ci" };

recorder.start(ctx);
// ... tool runs ...
recorder.complete(ctx, { durationMs: 1200, output: { ok: true }, cost: { amount: 0.0021 } });
// or, on failure:
// recorder.fail(ctx, { message: "rollout timed out" });
```

## API

| Export | Purpose |
| --- | --- |
| `TelemetryRecorder` | Ergonomic surface for emitting observations. `record(event)`, `start(ctx, extra?)`, `complete(ctx, {durationMs?, output?, cost?}, extra?)`, `fail(ctx, {message, code?}, extra?)`. |
| `TelemetryStore` | Store interface for events. |
| `InMemoryTelemetryStore` | Default volatile store. |
| `MemoryBackedTelemetryStore` | Folds events directly into a `MemoryStore` (the SSOT) via `recordExecution`. |
| `queries` | Read-side helpers over stored events. |

## License

Part of the Adaptive MCP monorepo. See the root [`README.md`](../../README.md).
