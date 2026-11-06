---
"@adaptivemcp/spec": minor
"@adaptivemcp/memory": minor
---

Record context loads, so a host can learn which context earns its tokens.

`ContextEvent`/`ContextStat` and optional `Store.recordContext`/`contextStats`: a load
folds into a metric cell under a reserved `context` scope, dimensioned by
`contextItem` + `contextKind`. No `tools` row is created — a context item is not a
tool — and the counters stay bounded like every other rollup, so a long session costs
one counter update per item, not a row per load.

This is the telemetry half of ADR-005's P1: without it a host can say what it loaded
but not what it was worth.
