---
"@adaptivemcp/spec": minor
"@adaptivemcp/memory": minor
"@adaptivemcp/routing": minor
---

Per-model statistics, and a router that uses them.

The store already folded a `{ model }` metric cell per tool (`MetricDimensions.model`,
with a cardinality cap), but nothing read it: `Router` chose from a static
cost/latency list, so "use the model that actually works on this tool" had no
evidence behind it.

- `spec`: `ModelStats`, and an optional `Store.modelStats(tool, server?)` — optional
  like `metricCells`, so a backend without dimensional rollups falls back cleanly.
- `memory`: `modelStats()` sums the `{ model }` lifetime cells (ignoring the overall
  cell, the decoding slices that would double-count, the hourly windows, and the
  `other` overflow bucket), and `modelStatsFromCells()` exposes the derivation.
- `routing`: `routeTool` now prefers the model with the best **observed** record when
  one has `minModelInvocations` (default 5) samples — reliability first, then latency,
  then cost — and only falls back to the static heuristic when no model has enough
  evidence. The rationale cites the sample count and failure rate it decided from.
