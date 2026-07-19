# @adaptivemcp/approval

Intent, plan, and tool approval experiments for Adaptive MCP.

> **Status:** published to npm as `@adaptivemcp/approval`. It is the
> enforcement hook for autonomy boundaries.

`approval` is the enforcement hook for autonomy boundaries. Given a tool name,
it returns an allow/confirm/deny decision based on its learned risk and
flakiness.

## Usage

```ts
import { MemoryStore } from "@adaptivemcp/memory";
import { ApprovalGate } from "@adaptivemcp/approval";

const memory = new MemoryStore();
const gate = new ApprovalGate({ memory });

// Before a tool runs:
const decision = gate.gate("deploy_service");
// -> "allow" | "require_confirmation" | "deny"
// High-risk tools (annotation risk: "high") or flaky tools require confirmation.
```

## What it does

- `gate(toolName)` → `"allow" | "require_confirmation" | "deny"`.
- `isFlaky(toolName)`: predicate used by the gate and other packages.

### Defaults

| Option | Default |
| --- | --- |
| `confirmRiskLevels` | `["high"]` |
| `flakyFailureRate` | `0.2` |
| `minInvocations` | `10` |

## Open questions

What should users approve? Can approval boundaries adapt? How much autonomy
should agents receive? See the root [`AGENTS.md`](../../AGENTS.md).

## License

Released under the [MIT License](../../LICENSE). Copyright (c) 2026 Kemal Elmizan.
