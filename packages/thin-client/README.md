# @adaptivemcp/thin-client

Minimal MCP client loop for Adaptive MCP.

> **Status:** private / not yet published. This package is implemented but its
> API is still stabilizing, so it is not part of the published `@adaptivemcp/*`
> set.

`thin-client` is the runtime engine that wires the learning packages into
execution. It is intentionally small: transport, capability negotiation,
middleware hooks, and the execution lifecycle. Business logic lives in the
middleware packages (`routing`, `orchestration`, `approval`).

## What it does

- `run(toolName, handler, input, record)`: execute a tool, consulting the
  approval `gate` and the orchestration retry policy, and recording the outcome
  into the SSOT.
- Does **not** implement MCP transport. That remains an implementation detail
  of the host.

## License

Released under the [MIT License](../../LICENSE). Copyright (c) 2026 Kemal Elmizan.
