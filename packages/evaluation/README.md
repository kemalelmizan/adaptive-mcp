# @adaptivemcp/evaluation

Outcome scoring and feedback loops for Adaptive MCP.

`evaluation` is the **evaluate → remember** step of the adaptation loop. It
reads the store stats from `@adaptivemcp/memory` and writes derived `Insight`s
back. For example, an `observed_failure_rate` or `avg_duration_ms` signal emerges
only once enough samples accumulate.

## Install

```bash
npm i @adaptivemcp/evaluation
```

Requires **Node 26**.

## Usage

```ts
import { MemoryStore } from "@adaptivemcp/memory";
import { Evaluator } from "@adaptivemcp/evaluation";

const store = new MemoryStore({ path: ":memory:" });
const evaluator = new Evaluator({ memory: store });

// After enough telemetry has accumulated:
const insights = evaluator.evaluateAll();
// e.g. [{ toolName: "deploy_service", key: "observed_failure_rate", value: 0.12, ... }]
```

## API

| Method | Purpose |
| --- | --- |
| `evaluateTool(toolName)` | Evaluate a single tool; persist and return derived insights. |
| `evaluateAll()` | Evaluate every known tool. |

### Defaults

| Option | Default | Meaning |
| --- | --- | --- |
| `failureRateThreshold` | `0.1` | Failure rate at/above which a `observed_failure_rate` insight is emitted. |
| `minInvocations` | `10` | Minimum invocations before a tool is evaluated (avoids low-sample noise). |

Insights emitted: `observed_failure_rate` and `avg_duration_ms`.

## License

Released under the [MIT License](../../LICENSE). Copyright (c) 2026 Kemal Elmizan.
