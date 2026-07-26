# @adaptivemcp/routing

Model selection and cost optimization for Adaptive MCP.

> **Status:** published to npm as `@adaptivemcp/routing`. It is the client-side
> **executor** of policy the server governs.

`routing` reads learned stats from the store (`@adaptivemcp/memory`) and emits
`model` and `routing` recommendations. For example, steer a flaky or expensive tool
toward a cheaper/faster model once the evidence supports it.

## Usage

```ts
import { MemoryStore } from "@adaptivemcp/memory";
import { Router } from "@adaptivemcp/routing";

const memory = new MemoryStore();
const router = new Router({
  memory,
  models: [
    { id: "gpt-5-mini", costWeight: 1, latencyWeight: 1 },
    { id: "gpt-5", costWeight: 4, latencyWeight: 0.6 },
  ],
  budget: { perToolLimit: 0.05 },
});

router.routeAll(); // writes `model` + `routing` recommendations into the store
```

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
