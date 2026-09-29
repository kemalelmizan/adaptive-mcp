---
"@adaptivemcp/spec": minor
"@adaptivemcp/memory": minor
"@adaptivemcp/evaluation": minor
"@adaptivemcp/extension": minor
"@adaptivemcp/thin-client": minor
---

Phase 6g/6h/6j exercised, plus metadata guardrails.

- **evaluation:** `Evaluator.evaluateCooccurrence()` — session-scoped
  `tool_cooccurrence` insight (most frequent partners + support), run as part of
  `evaluateAllWorkflows()`. New pure `computeMetricDrift()` — recent-vs-lifetime
  drift from metric cells.
- **memory/spec:** `Store.getSessionIds?()` + `MemoryStore` implementation; metric
  cardinality cap (`metricCardinality.maxModelsPerTool`, default 8) folds new
  models into an `other` bucket.
- **extension:** `aggregateViews()` also merges metric cells.
- **thin-client:** `OAuthMiddleware.handleCallback` now validates the CSRF `state`
  (single-use, server-bound, TTL); `afterCall` refreshes on 401 without the bogus
  retry throw. Adds an OAuth test suite.
