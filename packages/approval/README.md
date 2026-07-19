# @adaptivemcp/approval

Intent, plan, and tool approval experiments for Adaptive MCP.

> **Status:** private / not yet published. This package is an experimental
> research area (intent → plan → tool) and is not part of the published
> `@adaptivemcp/*` set.

`approval` is the enforcement hook for autonomy boundaries. Given a tool name,
it returns an allow/confirm/deny decision based on its learned risk and
flakiness.

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

Part of the Adaptive MCP monorepo. See the root [`README.md`](../../README.md).
