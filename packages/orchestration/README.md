# @adaptivemcp/orchestration

Composition and execution strategies for Adaptive MCP.

> **Status:** private / not yet published. This package is implemented but its
> API is still stabilizing, so it is not part of the published `@adaptivemcp/*`
> set. It is the client-side **executor** of policy the server governs.

`orchestration` turns learned stats into retry/execution policy. It plans a
retry policy per tool (e.g. cap `maxAttempts` for flaky tools) and is consulted
by the thin client at execution time.

## What it does

- `planAll()` / `planTool(toolName)`: derive a retry policy from observed failure behavior.
- Default policy: `maxAttempts: 3`; `policyFor` caps `maxAttempts` at `6`.
- Flags tools as flaky when failure rate exceeds `flakyThreshold`.

### Defaults

| Option | Default |
| --- | --- |
| `flakyThreshold` | `0.1` |
| `minInvocations` | `10` |

## License

Released under the [MIT License](../../LICENSE). Copyright (c) 2026 Kemal Elmizan.
