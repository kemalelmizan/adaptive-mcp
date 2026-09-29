---
"@adaptivemcp/spec": minor
"@adaptivemcp/memory": minor
"@adaptivemcp/routing": minor
"@adaptivemcp/runtime": minor
---

Rich, queryable metadata without a raw events table (ROADMAP 8d/8e).

- **spec:** `ToolExecutionEvent` gains optional `decoding` (`ToolDecoding`) and
  `usage`; new `MetricDimensions`/`MetricCell` types; `Store.metricCells?()`.
- **memory:** new `metric_cells` rollup table (migration 3). `recordExecution`
  folds each event into bounded dimensioned cells (counters, error codes, a
  fixed-bucket duration histogram, token/cost sums, EWMA recency, and a bounded
  exemplar ring) instead of retaining events. `metricCells()` reads them.
- **routing:** `DecodingAnalyzer` (pure, computed-on-read) over events or, via
  `analyzeCells()`, over the durable cells.
- **runtime:** `observeCompleted` forwards `decoding`/`usage` into the event.
