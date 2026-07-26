# @adaptivemcp/thin-client

Minimal MCP client loop for Adaptive MCP.

> **Status:** published to npm as `@adaptivemcp/thin-client`. It is the
> runtime engine that wires the learning packages into execution.

`thin-client` is the runtime engine that wires the learning packages into
execution. It is intentionally small: transport, capability negotiation,
middleware hooks, and the execution lifecycle. Business logic lives in the
middleware packages (`routing`, `orchestration`, `approval`).

## Usage

```ts
import { MemoryStore } from "@adaptivemcp/memory";
import { ApprovalGate } from "@adaptivemcp/approval";
import { ThinClient } from "@adaptivemcp/thin-client";

const memory = new MemoryStore();
const gate = new ApprovalGate({ memory });
const client = new ThinClient({
  memory,
  gate,
  requestApproval: (tool) => confirm(`${tool}?`), // human prompt in real use
});

await client.run(
  "deploy_service",
  async (input) => ({ ok: true }), // the actual tool call
  input,
  (ok, error) => memory.recordExecution(/* … */), // record the outcome
);
```

## What it does

- `run(toolName, handler, input, record)`: execute a tool, consulting the
  approval `gate` and the orchestration retry policy, and recording the outcome
  into the store.
- Does **not** implement MCP transport. That remains an implementation detail
  of the host.

## License

Released under the [MIT License](../../LICENSE). Copyright (c) 2026 Kemal Elmizan.
