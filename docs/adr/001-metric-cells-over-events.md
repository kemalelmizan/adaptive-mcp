# ADR-001: Pre-aggregated metric cells instead of a raw events table

**Status:** Accepted (2026-09-29). Rationale and follow-ups: `docs/doubts.md` §15.

## Context

Adaptive MCP keeps rich, queryable per-tool metadata so a host can learn from
observed behavior. The obvious design is an append-only `events` table plus
on-read aggregation. But the metadata is the *product*: it is projected into the
`dev.adaptivemcp/tools-metadata` view and reported to governing servers, so the
store should be bounded and cheap to read, not an ever-growing log. An events
table also invites raw-value retention, which conflicts with the security stance
(`SECURITY.md`).

## Decision

Fold each `ToolExecutionEvent` at write time into bounded **metric cells** keyed
by `(tool_name, server_name, window, dimensions)` (`packages/memory`). A cell is a
pre-aggregation: counters, a fixed-bucket duration histogram behind
`avgDurationMs`, token/cost sums, retry accounting, and an EWMA for recency.

- Windows: `all` (lifetime) plus hourly `hour:<...>` cells for drift.
- Dimensions are bounded by construction: the overall `{}` tuple, a per-`model`
  tuple, and a per-`decoding-profile` tuple. Distinct models are capped
  (`metricCardinality.maxModelsPerTool`, default 8); extras collapse into `other`.
- `execution_nodes` is retained separately (TTL-pruned) purely for drill-down /
  execution-graph intelligence — it is not the metadata source of truth.

The trade-off is explicitly **schema-on-write**: new dimensions require a fold
change, not a query.

## Consequences

- Reads are O(cells), not O(events); the view and reports stay cheap.
- Leakage is bounded by design (aggregates + a capped exemplar-id list), not by
  a retention policy bolted on later.
- Cardinality must be guarded (the model cap); new dimensions are a deliberate
  change.
- Analysis passes are computed-on-read over cells (`DecodingAnalyzer.analyzeCells`,
  `computeMetricDrift`) or over the retained nodes for graph work.

## Alternatives considered

- **Events table + on-read SQL.** Rejected: unbounded growth, expensive reads,
  and raw-value retention risk.
- **External OLAP store.** Rejected: violates the local-first, dependency-light
  posture (`packages/spec` stays dependency-light; the store is `node:sqlite`).
