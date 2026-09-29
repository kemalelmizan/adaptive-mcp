---
"@adaptivemcp/spec": minor
"@adaptivemcp/memory": minor
"@adaptivemcp/routing": minor
"@adaptivemcp/runtime": minor
"@adaptivemcp/thin-client": minor
"@adaptivemcp/extension": minor
---

Rich, queryable metadata without a raw events table; time-bucketed cells, retry
accounting, and metrics in the derived view.

- **spec:** `ToolExecutionEvent` gains optional `decoding`, `usage`, and
  `attempts`; new `MetricDimensions`/`MetricCell`; `Store.metricCells?()`.
- **memory:** migration 3 adds `metric_cells` — bounded dimension tuples folded
  on `recordExecution` (counters, error codes, a fixed-bucket duration histogram,
  token/cost sums, attempts, EWMA recency, bounded exemplars); migration 4 adds
  `attempts`. The overall cell also gets an hourly window for drift, pruned by
  retention. `metricCells()` reads them.
- **thin-client:** `ThinClient.run` returns `attempts` (≥1; >1 when retried).
- **runtime:** `observeCompleted` forwards `decoding`/`usage`/`attempts`.
- **routing:** `DecodingAnalyzer` (pure, computed-on-read) over events or, via
  `analyzeCells()`, the durable cells.
- **extension:** the derived view gains a per-tool `metrics` map (window/dimension
  labels → counts, failure rate, latency, tokens, `retry_rate`, EWMA).
