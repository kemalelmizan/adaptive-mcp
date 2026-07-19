# @adaptivemcp/routing

Model selection and cost optimization for Adaptive MCP.

> **Status:** private / not yet published. This package is implemented but its
> API is still stabilizing, so it is not part of the published `@adaptivemcp/*`
> set. It is the client-side **executor** of policy the server governs.

`routing` reads learned stats from the store (`@adaptivemcp/memory`) and emits
`model` and `routing` recommendations. For example, steer a flaky or expensive tool
toward a cheaper/faster model once the evidence supports it.

## What it does

- `routeAll()` / `routeTool(toolName)`: derive routing recommendations from observed stats.
- Emits `model` and `routing` recommendations into the store.
- Warns when projected cost crosses ~80% of a configured budget.

### Defaults

| Option | Default |
| --- | --- |
| `minInvocations` | `10` |

## License

Released under the [MIT License](../../LICENSE). Copyright (c) 2026 Kemal Elmizan.
