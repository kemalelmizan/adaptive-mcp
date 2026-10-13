# Architecture Decision Records

Short, durable records of the load-bearing decisions in Adaptive MCP: what we
chose, the alternatives, and the consequences. Where a decision is still
evolving, the reasoning lives in [`../doubts.md`](../doubts.md); an ADR here
means the decision has settled.

| ADR | Decision | Status |
| --- | --- | --- |
| [001](001-metric-cells-over-events.md) | Pre-aggregated metric cells instead of a raw events table | Accepted |
| [002](002-server-governed-precedence.md) | Server suggestions are a floor, never an override | Accepted |
| [003](003-decoding-resolver.md) | Table-driven, versioned decoding resolver | Accepted |
